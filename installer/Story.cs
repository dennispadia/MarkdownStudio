using System;
using System.Collections.Generic;
using System.Globalization;

namespace Lekh.Setup
{
    internal sealed class Story
    {
        internal const int LetterMilliseconds = 36;
        internal const int HoldMilliseconds = 2000;
        internal static readonly string[] Titles = {
            "A name with roots.", "From a mark to a meaning.", "A place for your next line."
        };
        internal static readonly string[] Chapters = {
            "Lekh takes its name from Sanskrit \u0932\u0947\u0916 (lekha): a line, a stroke, or a piece of writing. A small word with room for many thoughts.",
            "Behind lekha is the root \u0932\u093f\u0916\u094d (likh): to scratch, inscribe, or write. Writing begins with a mark, then gives that mark a meaning.",
            "That is the idea behind Lekh: a quiet place for your own words. Your files, familiar tools, and space to turn a first line into a story."
        };
        internal int Index { get; private set; }
        internal string Written { get; private set; }
        internal bool Playing { get; private set; }
        internal bool Writing { get { return Playing && position < letters.Length; } }
        private string[] letters;
        private int position;
        private long due;

        internal Story() { Show(false, 0); }
        internal void Play(bool enabled, long now)
        {
            if (Playing == enabled) return;
            Playing = enabled;
            Show(enabled, now);
        }
        internal void Browse(int direction, long now)
        {
            Index = (Index + direction + Chapters.Length) % Chapters.Length;
            Show(Playing, now);
        }
        private void Show(bool animate, long now)
        {
            letters = Elements(Chapters[Index]);
            position = animate ? 0 : letters.Length;
            Written = animate ? "" : Chapters[Index];
            due = now + (animate ? LetterMilliseconds : HoldMilliseconds);
        }
        internal bool Tick(long now)
        {
            if (!Playing || now < due) return false;
            if (position == letters.Length) Browse(1, now);
            else
            {
                Written += letters[position++];
                due = now + (position == letters.Length ? HoldMilliseconds : LetterMilliseconds);
            }
            return true;
        }
        internal static string[] Elements(string text)
        {
            // Framework StringInfo predates Indic conjunct clustering. Keep viramas and joiners with their following letter.
            List<string> result = new List<string>();
            string current = "";
            bool joinNext = false;
            for (int i = 0; i < text.Length; )
            {
                int size = Char.IsSurrogatePair(text, i) ? 2 : 1;
                string value = text.Substring(i, size);
                UnicodeCategory category = CharUnicodeInfo.GetUnicodeCategory(text, i);
                bool combining = category == UnicodeCategory.NonSpacingMark ||
                    category == UnicodeCategory.SpacingCombiningMark || category == UnicodeCategory.EnclosingMark;
                bool joiner = value == "\u200d" || value == "\u200c";
                if (current.Length > 0 && !combining && !joiner && !joinNext)
                {
                    result.Add(current);
                    current = "";
                }
                current += value;
                joinNext = value == "\u094d" || joiner;
                i += size;
            }
            if (current.Length > 0) result.Add(current);
            return result.ToArray();
        }
    }
}
