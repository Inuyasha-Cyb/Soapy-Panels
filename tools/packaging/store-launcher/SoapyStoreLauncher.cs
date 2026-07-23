using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("Soapy Panels Store Launcher")]
[assembly: AssemblyDescription("Full-trust AppX launcher for Soapy Panels")]
[assembly: AssemblyCompany("Soapy Panels")]
[assembly: AssemblyProduct("Soapy Panels")]
[assembly: AssemblyCopyright("Copyright Soapy Panels")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace SoapyPanels.StoreLauncher
{
  internal static class Program
  {
    private const string AppName = "Soapy Panels";
    private const string ElectronExecutableName = "SoapyPanels.exe";

    [STAThread]
    private static int Main(string[] args)
    {
      string logPath = ResolveLogPath();

      try
      {
        string launcherDir = AppDomain.CurrentDomain.BaseDirectory;
        string appDir = Path.GetFullPath(Path.Combine(launcherDir, "..", ".."));
        string electronPath = Path.Combine(appDir, ElectronExecutableName);

        Log(
          logPath,
          "start " +
            "pid=" + Process.GetCurrentProcess().Id +
            " launcherDir=" + launcherDir +
            " appDir=" + appDir +
            " electronPath=" + electronPath);

        if (!File.Exists(electronPath))
        {
          Log(logPath, "error electron executable missing: " + electronPath);
          return 2;
        }

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = electronPath;
        startInfo.WorkingDirectory = appDir;
        startInfo.UseShellExecute = false;
        startInfo.Arguments = BuildArgumentString(args);
        startInfo.EnvironmentVariables["SOAPY_STORE_LAUNCHER"] = "1";
        startInfo.EnvironmentVariables["SOAPY_STORE_LAUNCHER_LOG"] = logPath;
        startInfo.EnvironmentVariables["SOAPY_LOG_MAIN"] = "1";

        Process child = Process.Start(startInfo);
        if (child == null)
        {
          Log(logPath, "error Process.Start returned null");
          return 3;
        }

        Log(logPath, "child-started pid=" + child.Id + " args=" + startInfo.Arguments);
        child.WaitForExit();
        Log(logPath, "child-exited pid=" + child.Id + " exitCode=" + child.ExitCode);
        return child.ExitCode;
      }
      catch (Exception ex)
      {
        Log(logPath, "fatal " + ex);
        return 1;
      }
    }

    private static string ResolveLogPath()
    {
      return Path.Combine(ResolveLocalAppData(), AppName, "logs", "store-launcher.log");
    }

    private static string ResolveLocalAppData()
    {
      string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
      if (!string.IsNullOrEmpty(localAppData))
      {
        return localAppData;
      }

      localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
      if (!string.IsNullOrEmpty(localAppData))
      {
        return localAppData;
      }

      string appData = Environment.GetEnvironmentVariable("APPDATA");
      if (!string.IsNullOrEmpty(appData))
      {
        return appData;
      }

      return Path.GetTempPath();
    }

    private static string BuildArgumentString(string[] originalArgs)
    {
      List<string> quoted = new List<string>();
      if (originalArgs != null)
      {
        foreach (string arg in originalArgs)
        {
          quoted.Add(QuoteArgument(arg));
        }
      }
      return string.Join(" ", quoted.ToArray());
    }

    private static string QuoteArgument(string arg)
    {
      if (arg == null)
      {
        return "\"\"";
      }

      if (arg.Length == 0)
      {
        return "\"\"";
      }

      if (arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
      {
        return arg;
      }

      StringBuilder result = new StringBuilder();
      result.Append('"');
      int backslashes = 0;
      foreach (char c in arg)
      {
        if (c == '\\')
        {
          backslashes++;
          continue;
        }

        if (c == '"')
        {
          result.Append('\\', backslashes * 2 + 1);
          result.Append('"');
          backslashes = 0;
          continue;
        }

        result.Append('\\', backslashes);
        backslashes = 0;
        result.Append(c);
      }
      result.Append('\\', backslashes * 2);
      result.Append('"');
      return result.ToString();
    }

    private static void Log(string logPath, string message)
    {
      try
      {
        Directory.CreateDirectory(Path.GetDirectoryName(logPath));
        File.AppendAllText(
          logPath,
          "[" + DateTime.UtcNow.ToString("o") + "] " + message + Environment.NewLine,
          Encoding.UTF8);
      }
      catch
      {
        /* best effort */
      }
    }
  }
}
