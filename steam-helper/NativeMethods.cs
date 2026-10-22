using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace SteamHelper
{
    internal static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool SetDllDirectory(string lpPathName);

        [DllImport("steam_api.dll", CallingConvention = CallingConvention.Cdecl)]
        public static extern void SteamAPI_RunCallbacks();

        [StructLayout(LayoutKind.Sequential)]
        private struct Msg
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int x;
            public int y;
        }

        [DllImport("user32.dll")]
        private static extern bool PeekMessage(out Msg lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref Msg lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref Msg lpMsg);

        public static bool Wait(ManualResetEventSlim gate, int timeoutMs)
        {
            var start = Environment.TickCount;
            while (!gate.IsSet)
            {
                if (unchecked(Environment.TickCount - start) >= timeoutMs)
                {
                    return false;
                }

                Msg message;
                while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1))
                {
                    TranslateMessage(ref message);
                    DispatchMessage(ref message);
                }

                try
                {
                    SteamAPI_RunCallbacks();
                }
                catch (DllNotFoundException)
                {
                    // Steam API is loaded by the publisher wrapper before the first wait.
                }

                Thread.Sleep(30);
            }

            return true;
        }
    }
}
