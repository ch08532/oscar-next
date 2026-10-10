using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

public sealed class OscarNextHeadlessService : ServiceBase
{
    private Process child;
    private bool stopping;
    private readonly object logLock = new object();
    private string baseDir;

    public OscarNextHeadlessService()
    {
        ServiceName = "OscarNextHeadless";
        CanStop = true;
        CanShutdown = true;
        AutoLog = true;
        baseDir = AppDomain.CurrentDomain.BaseDirectory;
    }

    protected override void OnStart(string[] args) { StartChild(); }
    protected override void OnStop() { stopping = true; StopChild(); }
    protected override void OnShutdown() { stopping = true; StopChild(); base.OnShutdown(); }

    private static Dictionary<string,string> LoadConfig(string path)
    {
        var cfg = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            var i = line.IndexOf('=');
            if (i <= 0) continue;
            cfg[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
        }
        return cfg;
    }

    private static bool Bool(Dictionary<string,string> cfg, string key, bool fallback=false)
    {
        string value;
        return cfg.TryGetValue(key, out value) ? value.Equals("true", StringComparison.OrdinalIgnoreCase) : fallback;
    }

    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }

    private void StartChild()
    {
        var cfgPath = Path.Combine(baseDir, "service.conf");
        var cfg = LoadConfig(cfgPath);
        string node = cfg["NodePath"];
        string appDir = cfg["AppDir"];
        string main = Path.Combine(appDir, "dist", "src", "headless", "main.js");
        var parts = new List<string> {
            Quote(main), "--database", Quote(cfg["DatabasePath"]), "--host", cfg["Host"], "--port", cfg["Port"],
            "--web-root", Quote(cfg["WebRoot"]), "--log-dir", Quote(cfg["LogDir"])
        };
        if (Bool(cfg, "AllowImports")) parts.Add("--allow-imports");
        if (Bool(cfg, "WatchMedia")) parts.Add("--watch-media");
        if (Bool(cfg, "AutoImportMedia")) parts.Add("--auto-import-media");

        var psi = new ProcessStartInfo(node, String.Join(" ", parts.ToArray()));
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        string token;
        if (cfg.TryGetValue("ApiToken", out token) && token.Length > 0) psi.EnvironmentVariables["OSCAR_API_TOKEN"] = token;

        child = new Process();
        child.StartInfo = psi;
        child.EnableRaisingEvents = true;
        child.OutputDataReceived += (s,e) => { if (e.Data != null) WriteWrapperLog("OUT " + e.Data); };
        child.ErrorDataReceived += (s,e) => { if (e.Data != null) WriteWrapperLog("ERR " + e.Data); };
        child.Exited += (s,e) => {
            if (!stopping) {
                WriteWrapperLog("Headless process exited unexpectedly with code " + child.ExitCode + ".");
                Environment.Exit(child.ExitCode == 0 ? 1 : child.ExitCode);
            }
        };
        if (!child.Start()) throw new InvalidOperationException("Could not start Node.js headless process.");
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();
        WriteWrapperLog("Started OSCAR Next headless process PID " + child.Id + ".");
    }

    private void StopChild()
    {
        try {
            if (child == null || child.HasExited) return;
            WriteWrapperLog("Stopping OSCAR Next headless process PID " + child.Id + ".");
            child.Kill();
            child.WaitForExit(5000);
        }
        catch (Exception ex) { WriteWrapperLog("Stop error: " + ex.Message); }
    }

    private void WriteWrapperLog(string text)
    {
        try {
            lock (logLock) File.AppendAllText(Path.Combine(baseDir, "service-wrapper.log"), DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine);
        }
        catch { }
    }

    public static void Main()
    {
        ServiceBase.Run(new OscarNextHeadlessService());
    }
}
