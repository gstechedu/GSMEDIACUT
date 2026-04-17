using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace GSMEDIACUT.PC;

public partial class MainWindow : Window
{
    private static readonly Uri EditorUri = new("http://localhost:3000");
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly string _repoRoot;
    private readonly string _appRoot;
    private readonly string _draftsRoot;
    private readonly string _webViewUserDataRoot;
    private readonly string _projectsRoot;
    private readonly string _mediaRoot;
    private readonly string _exportsRoot;
    private readonly string _tempRoot;

    public MainWindow()
    {
        InitializeComponent();
        _repoRoot = ResolveRepoRoot();
        (
            _appRoot,
            _draftsRoot,
            _webViewUserDataRoot,
            _projectsRoot,
            _mediaRoot,
            _exportsRoot,
            _tempRoot
        ) = EnsureDesktopFolders();
        Loaded += MainWindow_Loaded;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await EnsureEditorAsync();
    }

    private async Task EnsureEditorAsync()
    {
        StatusText.Text = "Checking web editor status...";

        if (await IsEditorReachableAsync())
        {
            await LoadEditorAsync();
            return;
        }

        ShowOverlay(
            "The GSMEDIACUT web editor is not reachable at http://localhost:3000. Start apps/web, then retry."
        );
    }

    private async Task<bool> IsEditorReachableAsync()
    {
        try
        {
            using var response = await _httpClient.GetAsync(EditorUri);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private async Task LoadEditorAsync()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: _webViewUserDataRoot
            );
            await EditorView.EnsureCoreWebView2Async(environment);
            EditorView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            EditorView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            await EditorView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                BuildDesktopBootstrapScript()
            );
            EditorView.Source = EditorUri;
            OverlayPanel.Visibility = Visibility.Collapsed;
            StatusText.Text =
                $"Loaded web editor. App data: {_appRoot} | Drafts: {_draftsRoot}";
        }
        catch (Exception ex)
        {
            ShowOverlay($"WebView2 failed to initialize: {ex.Message}");
        }
    }

    private void ShowOverlay(string message)
    {
        OverlayStatusText.Text = message;
        OverlayPanel.Visibility = Visibility.Visible;
        StatusText.Text = message;
    }

    private async void RetryButton_Click(object sender, RoutedEventArgs e)
    {
        await EnsureEditorAsync();
    }

    private async void ReloadButton_Click(object sender, RoutedEventArgs e)
    {
        if (EditorView.CoreWebView2 is not null)
        {
            EditorView.Reload();
            StatusText.Text = "Reloaded desktop web view.";
            return;
        }

        await EnsureEditorAsync();
    }

    private void OpenBrowserButton_Click(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = EditorUri.ToString(),
            UseShellExecute = true,
        });
    }

    private void OpenAppFolderButton_Click(object sender, RoutedEventArgs e)
    {
        OpenFolder(_appRoot);
    }

    private void OpenDraftsFolderButton_Click(object sender, RoutedEventArgs e)
    {
        OpenFolder(_draftsRoot);
    }

    private void StartWebButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var bunPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".bun",
                "bin",
                "bun.exe"
            );

            Process.Start(new ProcessStartInfo
            {
                FileName = bunPath,
                Arguments = "run dev",
                WorkingDirectory = Path.Combine(_repoRoot, "apps", "web"),
                UseShellExecute = true,
            });

            ShowOverlay(
                $"Starting apps/web with Bun. Give it a few seconds, then press Retry.{Environment.NewLine}{Environment.NewLine}App data folder: {_appRoot}{Environment.NewLine}Drafts folder: {_draftsRoot}"
            );
        }
        catch (Exception ex)
        {
            ShowOverlay($"Failed to start apps/web: {ex.Message}");
        }
    }

    private static string ResolveRepoRoot()
    {
        var current = AppContext.BaseDirectory;
        for (var i = 0; i < 8; i++)
        {
            var candidate = Path.GetFullPath(
                Path.Combine(current, string.Join(Path.DirectorySeparatorChar, Enumerable.Repeat("..", i)))
            );

            if (
                File.Exists(Path.Combine(candidate, "Cargo.toml")) &&
                Directory.Exists(Path.Combine(candidate, "apps", "web"))
            )
            {
                return candidate;
            }
        }

        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
    }

    private static (
        string AppRoot,
        string DraftsRoot,
        string WebViewUserDataRoot,
        string ProjectsRoot,
        string MediaRoot,
        string ExportsRoot,
        string TempRoot
    ) EnsureDesktopFolders()
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appRoot = Path.Combine(userProfile, "GSMEDIACUT");
        var draftsRoot = Path.Combine(userProfile, "GSMEDIACUT Drafts");
        var webViewUserDataRoot = Path.Combine(appRoot, "WebView2");
        var cacheRoot = Path.Combine(appRoot, "Cache");
        var logsRoot = Path.Combine(appRoot, "Logs");
        var projectsRoot = Path.Combine(draftsRoot, "Projects");
        var mediaRoot = Path.Combine(draftsRoot, "Media");
        var exportsRoot = Path.Combine(draftsRoot, "Exports");
        var tempRoot = Path.Combine(draftsRoot, "Temp");

        foreach (
            var folder in new[]
            {
                appRoot,
                draftsRoot,
                webViewUserDataRoot,
                cacheRoot,
                logsRoot,
                projectsRoot,
                mediaRoot,
                exportsRoot,
                tempRoot,
            }
        )
        {
            Directory.CreateDirectory(folder);
        }

        return (
            appRoot,
            draftsRoot,
            webViewUserDataRoot,
            projectsRoot,
            mediaRoot,
            exportsRoot,
            tempRoot
        );
    }

    private string BuildDesktopBootstrapScript()
    {
        var payload = JsonSerializer.Serialize(
            new
            {
                isDesktop = true,
                appRoot = _appRoot,
                draftsRoot = _draftsRoot,
                projectsRoot = _projectsRoot,
                mediaRoot = _mediaRoot,
                exportsRoot = _exportsRoot,
                tempRoot = _tempRoot,
            }
        );

        return $$"""
            window.GSMDesktop = Object.freeze({{payload}});
            window.__GSMDesktop = window.GSMDesktop;
            """;
    }

    private static void OpenFolder(string folderPath)
    {
        Directory.CreateDirectory(folderPath);
        Process.Start(
            new ProcessStartInfo
            {
                FileName = folderPath,
                UseShellExecute = true,
            }
        );
    }
}
