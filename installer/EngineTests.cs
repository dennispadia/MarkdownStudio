using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Controls;

namespace Lekh.Setup
{
    internal static class EngineTests
    {
        private static int assertions;
        private static void Check(bool condition, string message)
        {
            assertions++;
            if (!condition) throw new InvalidOperationException(message);
        }
        private static void Reject(Action action, string message)
        {
            bool rejected = false;
            try { action(); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected, message);
        }
        internal static int Run()
        {
            try
            {
                Progress();
                Identity();
                PreviousVersions();
                UpgradeSequence();
                Preview();
                Animation();
                Console.WriteLine("PASS: " + assertions + " native setup assertions.");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                return 1;
            }
        }
        private static void Progress()
        {
            MsiProgress p = new MsiProgress();
            Check(p.Percent == null, "Unknown progress must be indeterminate.");
            p.Message(0, 100, 0, 1);
            Check(p.Percent == null, "Script generation must be indeterminate.");
            p.Message(0, 100, 0, 0);
            p.Message(2, 20, 0, 0);
            Check(p.Percent == 20, "Explicit progress increments.");
            p.Message(1, 5, 1, 0);
            p.ActionData();
            Check(p.Percent == 25, "Action progress.");
            p.ResetAction(); p.ActionData();
            Check(p.Percent == 25, "Action reset stops implicit ticks.");
            p.Message(3, 100, 0, 0);
            Check(p.Percent == 12, "Extending progress total.");
            p.Message(2, 500, 0, 0);
            Check(p.Percent == 100, "Progress clamp.");
            p.ResetStage();
            Check(p.Percent == null, "A new stage never inherits the old stage's 100% completion.");
            p.Message(0, 100, 1, 0);
            p.Message(2, 25, 0, 0);
            Check(p.Backward && p.Percent == 75, "Rollback progress counts backwards.");
            p.Message(3, 100, 0, 0);
            Check(p.Percent == 87, "Backward progress extends both position and total.");
            p.Message(0, 0, 0, 0);
            Check(p.Percent == null, "Zero progress total.");
            Reject(() => p.Message(2, -1, 0, 0), "Negative ticks rejected.");
            Reject(() => p.Message(4, 1, 0, 0), "Unknown progress rejected.");
            Check(SetupPolicy.IsSuccess(0) && SetupPolicy.IsSuccess(3010), "Success and restart codes.");
            Check(!SetupPolicy.IsSuccess(1602) && !SetupPolicy.IsSuccess(1603), "Cancellation/failure aren't success.");
            NativeEngine engine = new NativeEngine(update => { }, text => { });
            Check(!engine.Installed, "Repair cache retention starts false, independently of UI exit codes.");
            Check(SetupPolicy.InstallProperties.Contains("DisableShutdown") &&
                SetupPolicy.InstallProperties.Contains("ReallySuppress"), "Never kill user apps or restart.");
        }
        private static Dictionary<string, string> Properties()
        {
            return new Dictionary<string, string> {
                { "ProductName", BuildInfo.ProductName }, { "ProductVersion", BuildInfo.Version },
                { "UpgradeCode", "{" + SetupPolicy.UpgradeCode + "}" }, { "MSIINSTALLPERUSER", "1" }
            };
        }
        private static void Identity()
        {
            Check(SetupPolicy.UpgradeCode == "DCBCF7FA-11DA-4F35-8D27-D066EEC6C582", "Independent stable Lekh upgrade identity.");
            SetupPolicy.ValidateProperties(Properties());
            Check(true, "Braced stable upgrade identity.");
            Dictionary<string, string> values = Properties();
            values["UpgradeCode"] = SetupPolicy.UpgradeCode.ToLowerInvariant();
            values["ProductVersion"] += ".0";
            SetupPolicy.ValidateProperties(values);
            Check(true, "Unbraced stable upgrade identity and MSI version.");
            foreach (string key in new[] { "ProductName", "ProductVersion", "UpgradeCode", "MSIINSTALLPERUSER" })
            {
                Dictionary<string, string> changed = Properties();
                changed[key] = "unexpected";
                Reject(() => SetupPolicy.ValidateProperties(changed), "Reject changed " + key);
                changed.Remove(key);
                Reject(() => SetupPolicy.ValidateProperties(changed), "Reject missing " + key);
            }
            values = Properties(); values["ALLUSERS"] = "2";
            Reject(() => SetupPolicy.ValidateProperties(values), "Machine-wide MSI rejected.");
            values = Properties(); values["UpgradeCode"] = "DB607F2E-1890-4740-9DA3-51B6EEDD16AE";
            Reject(() => SetupPolicy.ValidateProperties(values), "Another product cannot share Lekh's installer.");
            Check(SetupPolicy.IsInstalledApp(SetupPolicy.AppPath), "Current app detection.");
            string directory = Path.GetDirectoryName(SetupPolicy.AppPath);
            Check(!SetupPolicy.IsInstalledApp(Path.Combine(directory, "Other editor.exe")), "Independent application identity.");
            Check(!SetupPolicy.IsInstalledApp(Path.Combine(Path.GetTempPath(), BuildInfo.ExecutableName)), "Other copies not confused with installed app.");
            Check(BuildInfo.PayloadHash.Length == 64 && BuildInfo.InstallDirectory == "lekh", "Build identity.");
            Check(SetupPolicy.PathExistsExact(typeof(EngineTests).Assembly.Location), "Removal probe recognizes real files.");
            Check(!SetupPolicy.PathExistsExact(typeof(EngineTests).Assembly.Location + ".missing"), "Only explicit file/directory-not-found proves payload absence.");
        }
        private static void Animation()
        {
            Check(Story.LetterMilliseconds == 36 && Story.HoldMilliseconds == 2000, "Approved typing and hold durations.");
            Check(String.Join("", Story.Elements("\u0932\u0947\u0916")) == "\u0932\u0947\u0916", "Devanagari preserved.");
            Check(Story.Elements("\u0932\u0947\u0916")[0] == "\u0932\u0947", "Vowel signs never split.");
            Check(Story.Elements("\u0932\u093f\u0916\u094d")[1] == "\u0916\u094d", "Virama never split.");
            Check(Story.Elements("\u0915\u094d\u0937").Length == 1, "Indic conjunct never split.");
            Check(Story.Elements("\ud83d\udcdd").Length == 1, "Surrogate pair never split.");
            Story story = new Story();
            Check(story.Written == Story.Chapters[0] && !story.Playing, "Static initial state is readable.");
            long now = 0;
            story.Play(true, now);
            Check(story.Written == "" && story.Writing, "Start writing.");
            for (int chapter = 0; chapter < 4; chapter++)
            {
                int expected = chapter % 3;
                Check(story.Index == expected, "Cycle 1/3 to 2/3 to 3/3 to 1/3.");
                while (story.Writing)
                {
                    Check(!story.Tick(now + 35), "No premature character.");
                    now += 36;
                    Check(story.Tick(now), "Character becomes due.");
                    Check(Story.Chapters[expected].StartsWith(story.Written, StringComparison.Ordinal), "Writing preserves exact copy.");
                }
                Check(story.Written == Story.Chapters[expected], "Full chapter copy.");
                Check(!story.Tick(now + 1999) && story.Index == expected, "Hold for full two seconds AFTER final letter.");
                now += 2000;
                Check(story.Tick(now) && story.Index == (expected + 1) % 3, "Advance automatically at two seconds.");
            }
            int current = story.Index;
            story.Play(false, now);
            Check(!story.Writing && story.Written == Story.Chapters[current], "Pause/hidden/reduced motion exposes full text.");
            Check(!story.Tick(now + 50000) && story.Index == current, "Stopped animation does not rotate.");
            story.Browse(-1, now);
            Check(story.Index == (current + 2) % 3 && story.Written == Story.Chapters[story.Index], "Manual navigation while stopped.");
            story.Play(true, now);
            story.Browse(1, now);
            Check(story.Index == current && story.Writing, "Resume and manual navigation animate.");
            story.Play(false, now);
            Check(story.Index == current, "Completion retains current chapter.");
        }
        private static void PreviousVersions()
        {
            const string oldCode = "{11111111-1111-1111-1111-111111111111}";
            Func<string, uint, string, string> property = (code, context, field) =>
                context != 2 ? null : field == "VersionString" ? "0.8.1" : BuildInfo.ProductName;
            Check(ProductDiscovery.Read(new string[0], property) == null, "No registration means fresh installation.");
            InstalledProduct old = ProductDiscovery.Read(new[] { oldCode }, property);
            Check(old.ProductCode == oldCode && old.Version == "0.8.1" && old.Mode == "upgrade", "Registered published old version is detected exactly.");
            Check(old.Guidance.Contains("Lekh 0.8.1") && old.Guidance.Contains("Save your work and close Lekh"), "Guidance states the detected version and asks users to save and close.");
            Check(new InstalledProduct(oldCode, BuildInfo.Version + ".0").Mode == "repair", "Same MSI version is maintenance, not downgrade.");
            Check(new InstalledProduct(oldCode, "99.0.0").Mode == "downgrade", "Newer registration blocks downgrade.");
            Reject(() => ProductDiscovery.Read(new[] { oldCode, "{22222222-2222-2222-2222-222222222222}" }, property), "Multiple installations are not silently swept.");
            Reject(() => ProductDiscovery.Read(new[] { oldCode }, (code, context, field) => "Other editor"), "Managed/machine scope is not silently changed.");
            Reject(() => ProductDiscovery.Read(new[] { oldCode }, (code, context, field) => context == 2 ? "Other editor" : null), "Wrong named related product rejected.");
            Reject(() => ProductDiscovery.Read(new[] { oldCode }, (code, context, field) =>
                context != 2 ? null : field == "InstalledProductName" ? null : BuildInfo.ProductName), "Advertised-only registration is not misreported as installed.");
            Reject(() => ProductDiscovery.Read(new[] { oldCode }, (code, context, field) =>
                context != 2 ? null : field == "VersionString" ? "unknown" : BuildInfo.ProductName), "Invalid registered version rejected.");
            bool propagated = false;
            try { ProductDiscovery.Read(new[] { oldCode }, (code, context, field) => { throw new IOException("query failed"); }); }
            catch (IOException) { propagated = true; }
            Check(propagated, "Native query failures are never treated as product absence.");
        }
        private static void UpgradeSequence()
        {
            Dictionary<string, int> schedule = new Dictionary<string, int> {
                { "InstallInitialize", 1500 }, { "RemoveExistingProducts", 1501 }, { "LekhPreviousVersionRemoved", 1502 },
                { "ProcessComponents", 1600 }, { "InstallFiles", 4000 }
            };
            SetupPolicy.ValidateSchedule(schedule, true, true);
            Check(true, "Transactional removal precedes all new payload scripts.");
            schedule["RemoveExistingProducts"] = 1401;
            Reject(() => SetupPolicy.ValidateSchedule(schedule, true, true), "Nontransactional default removal is rejected.");
            schedule["RemoveExistingProducts"] = 6601;
            Reject(() => SetupPolicy.ValidateSchedule(schedule, true, true), "Install-new-first removal is rejected.");
            schedule["RemoveExistingProducts"] = 1501;
            Reject(() => SetupPolicy.ValidateSchedule(schedule, false, true), "Rollback-disabled packages are rejected.");
            Reject(() => SetupPolicy.ValidateSchedule(schedule, true, false), "Proxy-only checkpoint without correct custom action is rejected.");
            schedule["UnexpectedDeferredAction"] = 1501;
            Reject(() => SetupPolicy.ValidateSchedule(schedule, true, true), "Any unexpected pre-checkpoint script action is rejected.");
            InstalledProduct old = new InstalledProduct("{11111111-1111-1111-1111-111111111111}", "0.8.1");
            List<string> states = new List<string>();
            bool gone = false, present = false;
            int checks = 0;
            NativeEngine engine = new NativeEngine(update => states.Add(update.Stage), text => { }, old,
                () => { checks++; if (!gone) throw new InvalidDataException("Old registration/payload remains."); }, () => present);
            engine.ActionStarted("InstallInitialize");
            engine.ActionStarted("RemoveExistingProducts");
            engine.ActionStarted("InstallFiles");
            engine.ActionStarted("InstallFinalize");
            engine.ActionStarted("PublishProduct");
            Check(states[states.Count - 1] == "removing" && checks == 0, "Nested old uninstall actions never imply new installation or finishing.");
            Reject(() => engine.ActionStarted("LekhPreviousVersionRemoved"), "Checkpoint must verify real old registration/payload absence.");
            Check(!engine.RemovalConfirmed && states[states.Count - 1] == "removing", "Failed removal proof cannot advance UI.");
            gone = true;
            engine.ActionStarted("LekhPreviousVersionRemoved");
            Check(checks == 2 && engine.RemovalConfirmed && states[states.Count - 1] == "installing", "Only successful removal probe advances to install-new.");
            engine.ActionStarted("InstallFinalize");
            Check(states[states.Count - 1] == "installing", "InstallFinalize starts deferred file execution, not completion.");
            present = true;
            engine.ActionStarted("PublishProduct");
            Check(states[states.Count - 1] == "finishing", "Finishing follows new executable and app.asar presence.");
            engine.Cancel();
            Check(engine.CancellationReply(0x08000000) == 2 && !engine.CanCancel, "User cancellation is returned to MSI once, never kills a process.");
            Check(engine.CancellationReply(0x08000000) == 1, "Do not interrupt rollback by repeatedly sending Cancel.");
            engine.ActionStarted("Rollback");
            Check(states[states.Count - 1] == "rollback" && !engine.Installed, "Cancellation/rollback cannot be reported as success.");
            engine.ActionStarted("InstallFiles");
            Check(states[states.Count - 1] == "rollback", "Rollback actions never regress to the install-new stage.");
            states.Clear();
            NativeEngine repair = new NativeEngine(update => states.Add(update.Stage), text => { }, new InstalledProduct(old.ProductCode, BuildInfo.Version),
                () => { throw new InvalidDataException("Repair must not remove."); }, () => true);
            Check(repair.PropertiesForProduct(old.ProductCode).Contains("REINSTALL=ALL REINSTALLMODE=omus"), "Exact ProductCode reinstall uses genuine maintenance.");
            repair.ActionStarted("RemoveExistingProducts"); repair.ActionStarted("InstallFiles");
            Check(!states.Contains("removing") && !repair.RemovalConfirmed && states.Contains("installing"), "Exact same-product repair never pretends to uninstall.");
            repair.ActionStarted("PublishProduct");
            Check(states[states.Count - 1] == "installing", "Existing repair payload cannot imply finishing before deferred execution begins.");
            Check(!repair.PropertiesForProduct("{22222222-2222-2222-2222-222222222222}").Contains("REINSTALL=ALL"), "Different ProductCode same-version rebuild retains transactional major-upgrade handling.");
            Reject(() => engine.PropertiesForProduct(old.ProductCode), "An older version cannot be repaired with a reused new-version ProductCode.");
        }
        private static void Preview()
        {
            foreach (string state in new[] { "upgrade", "repair", "downgrade", "removing", "rollback" })
            {
                SetupWindow preview = new SetupWindow(state);
                Check(System.Windows.Automation.AutomationProperties.GetItemStatus(preview.Window) == state,
                    "Automation exposes the real native setup state, not a heading guess.");
                string heading = ((TextBlock)preview.Window.FindName("Heading")).Text;
                string body = ((TextBlock)preview.Window.FindName("Description")).Text;
                Button primary = (Button)preview.Window.FindName("Primary");
                if (state == "upgrade") Check(heading.Contains("0.8.1") && body.Contains("Save your work") && primary.Content.ToString().IndexOf("save", StringComparison.OrdinalIgnoreCase) >= 0, "Upgrade preview displays version and explicit save/close action.");
                if (state == "repair") Check(heading.Contains(BuildInfo.Version) && primary.Content.ToString().Contains("reinstall"), "Same-version preview offers reinstall.");
                if (state == "downgrade") Check(primary.Visibility == System.Windows.Visibility.Collapsed && body.Contains(BuildInfo.Version), "Downgrade preview has no install action.");
                if (state == "removing") Check(body.Contains("0.8.1") && ((TextBlock)preview.Window.FindName("Stages")).Text.Contains("REMOVE OLD"), "Visible removal stage identifies old version.");
                if (state == "rollback") Check(primary.Visibility == System.Windows.Visibility.Collapsed && heading.Contains("Rolling back"), "Rollback waits without retry/install action.");
                preview.Window.Close();
            }
        }
    }
}
