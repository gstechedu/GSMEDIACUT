using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace GSMEDIACUT.PC;

public partial class MainWindow : Window
{
    private static readonly Uri EditorUri = new("http://localhost:3000");
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly string _repoRoot;

    public MainWindow()
    {
        InitializeComponent();
        _repoRoot = ResolveRepoRoot();
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
            await EditorView.EnsureCoreWebView2Async();
            EditorView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            EditorView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            EditorView.Source = EditorUri;
            OverlayPanel.Visibility = Visibility.Collapsed;
            StatusText.Text = $"Loaded web editor: {EditorUri}";
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

            ShowOverlay("Starting apps/web with Bun. Give it a few seconds, then press Retry.");
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
}
