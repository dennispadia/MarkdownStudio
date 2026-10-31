using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Lekh.Setup
{
    internal sealed class SetupUpdate
    {
        public readonly string Stage;
        public readonly int? Percent;
        public readonly bool CanCancel;
        public SetupUpdate(string stage, int? percent, bool canCancel)
        {
            Stage = stage; Percent = percent; CanCancel = canCancel;
        }
    }

    internal sealed class MsiProgress
    {
        private long total, position, actionTicks;
        private bool backward, estimated, actionData;
        public bool Backward { get { return backward; } }
        public int? Percent
        {
            get { return total <= 0 || estimated ? (int?)null : (int)Math.Max(0, Math.Min(100, position * 100 / total)); }
        }
        public void ResetAction() { actionData = false; }
        public void ActionData() { if (actionData) Move(actionTicks); }
        private void Move(long ticks)
        {
            position = Math.Max(0, Math.Min(total, position + (backward ? -ticks : ticks)));
        }
        public void Message(int kind, int value, int direction, int script)
        {
            if (value < 0) throw new InvalidDataException("Windows Installer reported invalid progress.");
            switch (kind)
            {
                case 0:
                    total = value; backward = direction == 1; estimated = script == 1;
                    position = backward ? total : 0; actionTicks = 0; actionData = false;
                    break;
                case 1: actionTicks = value; actionData = direction == 1; break;
                case 2: Move(value); break;
                case 3: total += value; if (backward) position += value; break;
                default: throw new InvalidDataException("Unknown Windows Installer progress message.");
            }
        }
    }

    internal static class SetupPolicy
    {
        public const string UpgradeCode = "DCBCF7FA-11DA-4F35-8D27-D066EEC6C582";
        public const string InstallProperties = "REBOOT=ReallySuppress MSIRESTARTMANAGERCONTROL=DisableShutdown";
        public static string AppPath
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), BuildInfo.InstallDirectory, BuildInfo.ExecutableName); }
        }
        public static bool IsSuccess(uint result) { return result == 0 || result == 3010; }
        public static string ErrorDescription(uint result)
        {
            switch (result)
            {
                case 1618: return "Another Windows installation is in progress. Let it finish, then try again.";
                case 1638: return "This version or a newer version is already installed. Use Windows Settings to manage the existing installation.";
                case 112: return "Windows needs more free disk space. Free some space, then try again.";
                case 1619: case 1620: return "Windows could not open the verified installer. See the setup log and follow your Windows security policy.";
                case 1625: return "Windows policy blocked installation. Contact your administrator; do not disable security protections.";
                default: return "Windows Installer could not complete setup. Review the local log for details, then try again.";
            }
        }
        public static bool IsInstalledApp(string path)
        {
            string full = Path.GetFullPath(path);
            return String.Equals(full, AppPath, StringComparison.OrdinalIgnoreCase);
        }
        public static bool AppIsOpen()
        {
            int session = Process.GetCurrentProcess().SessionId;
            foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(BuildInfo.ExecutableName)))
            {
                using (process)
                {
                    if (process.SessionId == session)
                    {
                        try
                        {
                            if (IsInstalledApp(process.MainModule.FileName)) return true;
                        }
                        catch (InvalidOperationException)
                        {
                            if (!process.HasExited) throw;
                        }
                    }
                }
            }
            return false;
        }
        public static void ValidateProperties(IDictionary<string, string> properties)
        {
            string name, version, upgrade, user;
            if (!properties.TryGetValue("ProductName", out name) || name != BuildInfo.ProductName ||
                !properties.TryGetValue("ProductVersion", out version) || (version != BuildInfo.Version && version != BuildInfo.Version + ".0") ||
                !properties.TryGetValue("UpgradeCode", out upgrade) || !String.Equals(upgrade.Trim('{', '}'), UpgradeCode, StringComparison.OrdinalIgnoreCase) ||
                properties.ContainsKey("ALLUSERS") || !properties.TryGetValue("MSIINSTALLPERUSER", out user) || user != "1")
                throw new InvalidDataException("The embedded MSI does not match the expected per-user Lekh package.");
        }
    }

    internal sealed class NativeEngine
    {
        private readonly Action<SetupUpdate> update;
        private readonly Action<string> log;
        private readonly MsiProgress progress = new MsiProgress();
        private volatile bool cancelRequested, canCancel = true;
        private bool cancelSent, finishing;
        private string lastUpdate;
        public string FailureMessage { get; private set; }
        public bool FilesInUse { get; private set; }
        public bool Installed { get; private set; }
        public bool CanCancel { get { return canCancel; } }
        public NativeEngine(Action<SetupUpdate> report, Action<string> writeLog)
        {
            update = report; log = writeLog;
        }
        public void Cancel() { if (canCancel) cancelRequested = true; }
        private void Report()
        {
            string stage = cancelRequested ? "stopping" : finishing ? "finishing" : "installing";
            int? percent = cancelRequested ? null : progress.Percent;
            string key = stage + ":" + percent + ":" + canCancel;
            if (key == lastUpdate) return;
            lastUpdate = key;
            update(new SetupUpdate(stage, percent, canCancel && !cancelRequested));
        }
        private int Callback(IntPtr context, uint type, uint record)
        {
            try
            {
                uint message = type & 0xff000000;
                switch (message)
                {
                    case 0x0a000000:
                        progress.Message(Native.MsiRecordGetInteger(record, 1), Native.MsiRecordGetInteger(record, 2),
                            Native.MsiRecordGetInteger(record, 3), Native.MsiRecordGetInteger(record, 4));
                        Report();
                        break;
                    case 0x09000000: progress.ActionData(); Report(); break;
                    case 0x08000000:
                        progress.ResetAction();
                        string action = Native.RecordString(record, 1);
                        finishing = action == "InstallFinalize";
                        log("Windows Installer action: " + action);
                        Report();
                        break;
                    case 0x0b000000:
                        if (Native.MsiRecordGetInteger(record, 1) == 2)
                        {
                            canCancel = Native.MsiRecordGetInteger(record, 2) == 1;
                            Report();
                        }
                        break;
                    case 0x05000000: case 0x19000000:
                        FilesInUse = true;
                        FailureMessage = "Windows reports that application files are in use. Save your work, close the applications using those files, and try again.";
                        log(FailureMessage);
                        cancelSent = true; canCancel = false;
                        update(new SetupUpdate("stopping", null, false));
                        return 2;
                    case 0x00000000: case 0x01000000: case 0x02000000: case 0x03000000: case 0x07000000:
                        FailureMessage = Native.FormatRecord(record);
                        log("Windows Installer message: " + FailureMessage);
                        // Never automatically choose Ignore, Continue, or Yes for an unexpected installer prompt.
                        int buttons = (int)(type & 0x0f);
                        return buttons == 2 ? 3 : buttons == 4 ? 7 : buttons == 0 ? 1 : 2;
                    case 0x04000000: return 1;
                    default: return 0;
                }
                if (cancelRequested && !cancelSent && canCancel &&
                    (message == 0x0a000000 || message == 0x09000000 || message == 0x08000000))
                {
                    cancelSent = true;
                    canCancel = false;
                    Report();
                    return 2;
                }
                return 1;
            }
            catch (Exception error)
            {
                // Exceptions must not cross the unmanaged callback boundary.
                FailureMessage = "Setup could not process a Windows Installer message: " + error.Message;
                // A failed log must not escape through this unmanaged callback either.
                try { log(FailureMessage + Environment.NewLine + error); }
                catch (Exception logError) { FailureMessage += " Diagnostic logging also failed: " + logError.Message; }
                return -1;
            }
        }
        public uint Install(string package, string logPath)
        {
            Native.Check(Native.MsiEnableLog(0x1fff, logPath, 0), "Enable Windows Installer logging");
            uint previousUI = Native.MsiSetInternalUI(2, IntPtr.Zero);
            if (previousUI == 0) throw new InvalidOperationException("Could not configure Windows Installer UI.");
            Native.RecordHandler callback = Callback, previous = null;
            bool registered = false;
            try
            {
                uint filter = 0xfffu | (1u << 25);
                Native.Check(Native.MsiSetExternalUIRecord(callback, filter, IntPtr.Zero, out previous), "Register installer progress");
                registered = true;
                uint result = Native.MsiInstallProduct(package, SetupPolicy.InstallProperties);
                Installed = SetupPolicy.IsSuccess(result);
                return result;
            }
            finally
            {
                if (registered)
                {
                    Native.RecordHandler ignored;
                    Native.Check(Native.MsiSetExternalUIRecord(previous, 0, IntPtr.Zero, out ignored), "Restore installer progress handler");
                }
                Native.MsiSetInternalUI(previousUI, IntPtr.Zero);
                Native.Check(Native.MsiEnableLog(0, null, 0), "Close installer logging");
                GC.KeepAlive(callback);
            }
        }
    }

    internal static class Payload
    {
        public static string Extract(Func<bool> cancelled, string cacheRoot = null)
        {
            string directory = Path.Combine(cacheRoot ?? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lekh", "SetupCache"),
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            string target = Path.Combine(directory, "Lekh.msi");
            try
            {
                using (Stream input = typeof(Payload).Assembly.GetManifestResourceStream("Setup.Payload.msi"))
                using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (SHA256 hash = SHA256.Create())
                {
                    if (input == null) throw new InvalidDataException("Embedded offline installer is missing.");
                    byte[] buffer = new byte[1024 * 1024];
                    int count;
                    while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        if (cancelled()) throw new OperationCanceledException();
                        output.Write(buffer, 0, count);
                        hash.TransformBlock(buffer, 0, count, buffer, 0);
                    }
                    hash.TransformFinalBlock(buffer, 0, 0);
                    string digest = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
                    if (digest != BuildInfo.PayloadHash) throw new InvalidDataException("Embedded installer checksum mismatch.");
                }
                Validate(target);
                return target;
            }
            catch
            {
                Remove(target);
                throw;
            }
        }
        public static void Remove(string package)
        {
            File.Delete(package);
            Directory.Delete(Path.GetDirectoryName(package));
        }
        public static void Validate(string package)
        {
            uint database;
            Native.Check(Native.MsiOpenDatabase(package, IntPtr.Zero, out database), "Open embedded MSI");
            try
            {
                uint view;
                Native.Check(Native.MsiDatabaseOpenView(database, "SELECT `Property`, `Value` FROM `Property`", out view), "Read MSI identity");
                try
                {
                    Native.Check(Native.MsiViewExecute(view, 0), "Query MSI identity");
                    Dictionary<string, string> properties = new Dictionary<string, string>();
                    uint record, result;
                    while ((result = Native.MsiViewFetch(view, out record)) == 0)
                    {
                        try { properties.Add(Native.RecordString(record, 1), Native.RecordString(record, 2)); }
                        finally { Native.MsiCloseHandle(record); }
                    }
                    if (result != 259) Native.Check(result, "Read MSI property");
                    SetupPolicy.ValidateProperties(properties);
                }
                finally { Native.MsiCloseHandle(view); }
            }
            finally { Native.MsiCloseHandle(database); }
        }
    }

    internal static class Native
    {
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        internal delegate int RecordHandler(IntPtr context, uint message, uint record);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiInstallProductW")]
        internal static extern uint MsiInstallProduct(string package, string properties);
        [DllImport("msi.dll")] internal static extern uint MsiSetInternalUI(uint level, IntPtr window);
        [DllImport("msi.dll")] internal static extern uint MsiSetExternalUIRecord(RecordHandler handler, uint filter, IntPtr context, out RecordHandler previous);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiEnableLogW")]
        internal static extern uint MsiEnableLog(uint mode, string path, uint attributes);
        [DllImport("msi.dll")] internal static extern int MsiRecordGetInteger(uint record, uint field);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiRecordGetStringW")]
        private static extern uint MsiRecordGetString(uint record, uint field, StringBuilder value, ref uint length);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiFormatRecordW")]
        private static extern uint MsiFormatRecord(uint install, uint record, StringBuilder value, ref uint length);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiOpenDatabaseW")]
        internal static extern uint MsiOpenDatabase(string path, IntPtr persistence, out uint database);
        [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiDatabaseOpenViewW")]
        internal static extern uint MsiDatabaseOpenView(uint database, string query, out uint view);
        [DllImport("msi.dll")] internal static extern uint MsiViewExecute(uint view, uint record);
        [DllImport("msi.dll")] internal static extern uint MsiViewFetch(uint view, out uint record);
        [DllImport("msi.dll")] internal static extern uint MsiCloseHandle(uint handle);
        internal static void Check(uint result, string operation)
        {
            if (result != 0) throw new InvalidOperationException(operation + " failed (Windows code " + result + ").");
        }
        internal static string RecordString(uint record, uint field)
        {
            uint length = 0;
            uint result = MsiRecordGetString(record, field, null, ref length);
            if (result != 0 && result != 234) Check(result, "Measure MSI string");
            StringBuilder value = new StringBuilder(checked((int)length + 1));
            length++;
            Check(MsiRecordGetString(record, field, value, ref length), "Read MSI string");
            return value.ToString();
        }
        internal static string FormatRecord(uint record)
        {
            uint length = 0;
            uint result = MsiFormatRecord(0, record, null, ref length);
            if (result != 0 && result != 234) Check(result, "Measure installer message");
            StringBuilder value = new StringBuilder(checked((int)length + 1));
            length++;
            Check(MsiFormatRecord(0, record, value, ref length), "Read installer message");
            return value.ToString();
        }
    }
}
