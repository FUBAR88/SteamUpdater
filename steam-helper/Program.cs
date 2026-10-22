using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

namespace SteamHelper
{
    internal static class Program
    {
        private const string DefaultPublisherDir = @"C:\Program Files (x86)\Steam\steamapps\common\DayZ Tools\Bin\Publisher";

        [STAThread]
        private static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            Request request;
            try
            {
                var input = Console.In.ReadToEnd();
                request = serializer.Deserialize<Request>(input) ?? new Request();
            }
            catch (Exception ex)
            {
                WriteResult(serializer, Result.Fail(ex.GetBaseException().Message));
                return 1;
            }

            if (string.IsNullOrWhiteSpace(request.publisherDir))
            {
                request.publisherDir = DefaultPublisherDir;
            }

            try
            {
                PrepareRuntime(request.publisherDir);
                var result = SteamSession.Run(request);
                WriteResult(serializer, result);
                Console.Out.Flush();
                Environment.Exit(result.ok ? 0 : 1);
                return 1;
            }
            catch (Exception ex)
            {
                WriteResult(serializer, Result.Fail(ex.GetBaseException().Message));
                return 1;
            }
        }

        private static void PrepareRuntime(string publisherDir)
        {
            var exeDir = AppDomain.CurrentDomain.BaseDirectory;
            Environment.CurrentDirectory = exeDir;
            var appIdFile = Path.Combine(exeDir, "steam_appid.txt");
            if (!File.Exists(appIdFile))
            {
                File.WriteAllText(appIdFile, "221100");
            }

            if (!Directory.Exists(publisherDir) || !File.Exists(Path.Combine(publisherDir, "SteamLayerWrap.dll")))
            {
                throw new InvalidOperationException("DayZ Publisher was not found at " + publisherDir);
            }

            var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            Environment.SetEnvironmentVariable("PATH", publisherDir + ";" + pathEnv);
            NativeMethods.SetDllDirectory(publisherDir);

            AppDomain.CurrentDomain.AssemblyResolve += (sender, args) => ResolvePublisherAssembly(publisherDir, args.Name);
            Assembly.LoadFrom(Path.Combine(publisherDir, "Publisher.Core.dll"));
        }

        private static Assembly ResolvePublisherAssembly(string publisherDir, string fullName)
        {
            var simple = new AssemblyName(fullName).Name;
            if (simple.EndsWith(".resources", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            foreach (var loaded in AppDomain.CurrentDomain.GetAssemblies())
            {
                if (string.Equals(loaded.GetName().Name, simple, StringComparison.OrdinalIgnoreCase))
                {
                    return loaded;
                }
            }

            var candidate = Path.Combine(publisherDir, simple + ".dll");
            if (!File.Exists(candidate))
            {
                return null;
            }

            return Assembly.LoadFrom(candidate);
        }

        private static void WriteResult(JavaScriptSerializer serializer, Result result)
        {
            Console.Out.WriteLine(serializer.Serialize(result));
        }
    }
}
