using System;
using System.Collections.Generic;
using System.IO;

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
            Check(SetupPolicy.IsInstalledApp(SetupPolicy.AppPath), "Current app detection.");
            string directory = Path.GetDirectoryName(SetupPolicy.AppPath);
            Check(SetupPolicy.IsInstalledApp(Path.Combine(directory, "Markdown Studio.exe")), "Legacy running app detection.");
            Check(!SetupPolicy.IsInstalledApp(Path.Combine(Path.GetTempPath(), BuildInfo.ExecutableName)), "Other copies not confused with installed app.");
            Check(BuildInfo.PayloadHash.Length == 64 && BuildInfo.InstallDirectory == "markdown-studio", "Build identity.");
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
    }
}
