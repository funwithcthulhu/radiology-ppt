using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using Microsoft.Win32;

namespace RadiologyPpt.App;

public partial class MainWindow : Window
{
    private readonly BackendClient _backend = new();
    private readonly AppStorage _storage;
    private readonly AppJobRunner _jobs = new();
    private readonly CaseLibraryViewModel _library = new();
    private readonly MainWindowViewModel _viewModel = new();
    private readonly BackendHealthMonitor _healthMonitor;
    private string _lastPowerPointPath = "";

    public ObservableCollection<CaseRequestRow> Requests => _viewModel.Requests;

    public string StatusText
    {
        get => _viewModel.StatusText;
        set => _viewModel.StatusText = value;
    }

    public string LastPowerPointText
    {
        get => _viewModel.LastPowerPointText;
        set => _viewModel.LastPowerPointText = value;
    }

    public MainWindow()
    {
        InitializeComponent();
        _storage = new AppStorage(_backend.StateDir, _backend.AppRoot);
        _healthMonitor = new BackendHealthMonitor(_backend, AppendLog);
        _healthMonitor.StatusChanged += BackendHealth_StatusChanged;
        DataContext = _viewModel;
        InitializeOptionControls();
        InitializeStorage();
        LoadSavedSettings();
        RequestsGrid.ItemsSource = Requests;
        LibraryGrid.ItemsSource = _library.Items;
        Requests.Add(new CaseRequestRow());
        AppendLog("C# desktop app started.");
        AppendLog($"Project root: {_backend.ProjectRoot}");
        AppendLog($"Node runtime: {_backend.NodePath}");
        AppendLog($"State database: {_storage.DatabasePath}");
        RefreshDiagnostics();
        _healthMonitor.Start();
    }

    private void Window_SourceInitialized(object? sender, EventArgs e)
    {
        WindowPlacement.ClampToVisibleWorkArea(this);
    }

    private void InitializeOptionControls()
    {
        ModeColumn.ItemsSource = AppOptions.RequestModes;
        ModalityColumn.ItemsSource = AppOptions.Modalities;
        AnatomyColumn.ItemsSource = AppOptions.Anatomy;
        SubspecialtyColumn.ItemsSource = AppOptions.Subspecialties;
        AgeColumn.ItemsSource = AppOptions.AgeGroups;
        TopicColumn.ItemsSource = AppOptions.TopicFocuses;
        DifficultyColumn.ItemsSource = AppOptions.Difficulties;
        LibraryDecisionFilter.ItemsSource = new[] { "All", "approved", "favorite", "skipped", "rejected" };
        LibraryDecisionFilter.SelectedIndex = 0;

        BoardDomainCombo.ItemsSource = AppOptions.BoardDomains;
        BoardDomainCombo.SelectedIndex = 0;
        PowerPointStyleCombo.ItemsSource = AppOptions.PowerPointStyles;
        PowerPointStyleCombo.SelectedIndex = 0;
        ThemeCombo.ItemsSource = AppOptions.Themes;
        ThemeCombo.SelectedIndex = 0;
        PresetCombo.ItemsSource = AppOptions.PowerPointPresets;
        PresetCombo.SelectedIndex = 0;
        OllamaModelCombo.Text = "moondream";
    }

    private void InitializeStorage()
    {
        try
        {
            _storage.Initialize();
        }
        catch (Exception exception)
        {
            AppendLog($"Storage warning: {exception.Message}");
        }
    }

    private void LoadSavedSettings()
    {
        try
        {
            var values = _storage.LoadSettings();
            if (values.TryGetValue("title", out var title))
            {
                TitleBox.Text = title;
            }
            if (values.TryGetValue("images_per_case", out var imagesPerCase))
            {
                ImagesPerCaseBox.Text = imagesPerCase;
            }
            if (values.TryGetValue("output_path", out var outputPath))
            {
                OutputBox.Text = outputPath;
            }
            SetCheckBox(AutoOpenCheck, values, "auto_open");
            SetCheckBox(ClinicalHistoryCheck, values, "use_clinical_history");
            SetCheckBox(OllamaCheck, values, "use_ollama_review");
            SetCheckBox(TeachingPointsCheck, values, "include_teaching_points");
            SetCheckBox(OnlyNewRandomCheck, values, "only_new_random_cases");
            SelectByCliValue(ThemeCombo, AppOptions.Themes, AppOptions.ThemeCliValue, values, "theme");
            SelectByCliValue(PowerPointStyleCombo, AppOptions.PowerPointStyles, AppOptions.PowerPointStyleCliValue, values, "powerpoint_style");
            if (values.TryGetValue("ollama_model", out var ollamaModel) && !string.IsNullOrWhiteSpace(ollamaModel))
            {
                OllamaModelCombo.Text = ollamaModel;
            }
        }
        catch (Exception exception)
        {
            AppendLog($"Settings warning: {exception.Message}");
        }
    }

    private void CasesNav_Click(object sender, RoutedEventArgs e) => SelectTab(MainTab.Cases);
    private void LibraryNav_Click(object sender, RoutedEventArgs e)
    {
        SelectTab(MainTab.Library);
        RefreshLibrary();
    }
    private void CoreBoardsNav_Click(object sender, RoutedEventArgs e) => SelectTab(MainTab.CoreBoards);
    private void PowerPointNav_Click(object sender, RoutedEventArgs e) => SelectTab(MainTab.PowerPoint);
    private void ActivityNav_Click(object sender, RoutedEventArgs e)
    {
        SelectTab(MainTab.Activity);
        RefreshDiagnostics();
    }

    private void AddRow_Click(object sender, RoutedEventArgs e)
    {
        Requests.Add(new CaseRequestRow());
        RequestsGrid.SelectedIndex = Requests.Count - 1;
    }

    private void RemoveSelectedRow_Click(object sender, RoutedEventArgs e)
    {
        if (RequestsGrid.SelectedItem is CaseRequestRow selected)
        {
            Requests.Remove(selected);
        }

        if (Requests.Count == 0)
        {
            Requests.Add(new CaseRequestRow());
        }
    }

    private void LoadFile_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "Text or JSON files (*.txt;*.json)|*.txt;*.json|All files (*.*)|*.*",
            Multiselect = false
        };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        var lines = File.ReadAllLines(dialog.FileName, Encoding.UTF8)
            .Select(line => Regex.Replace(line, "#.*$", "").Trim())
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .ToArray();
        if (lines.Length == 0)
        {
            MessageBox.Show(this, "That file did not contain any case requests.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        Requests.Clear();
        foreach (var line in lines)
        {
            Requests.Add(RowFromLine(line));
        }
        AppendLog($"Loaded {lines.Length} request(s) from {dialog.FileName}");
    }

    private static CaseRequestRow RowFromLine(string line)
    {
        var row = new CaseRequestRow { Query = line };
        if (line.Contains("radiopaedia.org/cases/", StringComparison.OrdinalIgnoreCase)
            || line.StartsWith("/cases/", StringComparison.OrdinalIgnoreCase))
        {
            row.Mode = AppOptions.RequestModes[2];
        }
        else if (Regex.IsMatch(line, @"\brandom\b", RegexOptions.IgnoreCase) || Regex.IsMatch(line, @"^\d+$"))
        {
            row.Mode = AppOptions.RequestModes[1];
            if (int.TryParse(line, out var count))
            {
                row.Query = "";
                row.Count = count;
            }
        }
        return row;
    }

    private void BrowseOutput_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            Filter = "PowerPoint files (*.pptx)|*.pptx",
            DefaultExt = ".pptx",
            AddExtension = true,
            FileName = string.IsNullOrWhiteSpace(TitleBox.Text) ? "radiology-cases.pptx" : $"{Slugify(TitleBox.Text)}.pptx"
        };
        if (dialog.ShowDialog(this) == true)
        {
            OutputBox.Text = dialog.FileName;
        }
    }

    private async void RefreshOllama_Click(object sender, RoutedEventArgs e)
    {
        StatusText = "Checking Ollama models...";
        var models = await _backend.ListOllamaModelsAsync();
        OllamaModelCombo.ItemsSource = models;
        if (models.Length > 0)
        {
            OllamaModelCombo.SelectedIndex = 0;
            StatusText = $"Found {models.Length} Ollama model(s).";
        }
        else
        {
            StatusText = "No Ollama models found. You can still type a model name.";
        }
    }

    private void PresetCombo_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        PresetDescriptionText.Text = PresetCombo.SelectedItem is PowerPointPreset preset
            ? preset.Description
            : "";
    }

    private void ApplyPreset_Click(object sender, RoutedEventArgs e)
    {
        if (PresetCombo.SelectedItem is not PowerPointPreset preset)
        {
            return;
        }

        ImagesPerCaseBox.Text = preset.ImagesPerCase.ToString();
        SelectComboByCliValue(PowerPointStyleCombo, AppOptions.PowerPointStyles, AppOptions.PowerPointStyleCliValue, preset.PowerPointStyle);
        SelectComboByCliValue(ThemeCombo, AppOptions.Themes, AppOptions.ThemeCliValue, preset.Theme);
        ClinicalHistoryCheck.IsChecked = preset.UseClinicalHistory;
        OllamaCheck.IsChecked = preset.UseOllamaReview;
        TeachingPointsCheck.IsChecked = preset.IncludeTeachingPoints;
        StatusText = $"Applied preset: {preset.Name}";
    }

    private async void Generate_Click(object sender, RoutedEventArgs e)
    {
        var settings = BuildSettings();
        var rows = _viewModel.UsableRows();
        if (rows.Length == 0)
        {
            MessageBox.Show(this, "Add at least one diagnosis, random case, or manual Radiopaedia case URL first.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var requests = _viewModel.BuildRequestPayloads(rows, settings);
        _storage.SaveGenerationSettings(settings);
        var reviewSessionId = "";
        try
        {
            SelectTab(MainTab.Activity);
            AppendLog($"Preparing {rows.Length} request row(s)...");
            var prepareSettings = settings with { UseOllamaReview = false };
            var prepared = await _jobs.RunAsync(
                "Preparing cases...",
                OnJobChanged,
                token => _backend.PrepareAsync(requests, prepareSettings, AppendLog, token));
            var preparedItems = BackendPayloadReader.ReadPreparedItems(prepared);
            var failures = BackendPayloadReader.ReadFailures(prepared);
            foreach (var failure in failures)
            {
                AppendLog($"Warning: {failure}");
            }

            if (preparedItems.Count == 0)
            {
                MessageBox.Show(this, MainWindowViewModel.BuildFailureMessage(failures), Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                StatusText = "No cases prepared";
                return;
            }

            reviewSessionId = _storage.CreateReviewSession(prepared, MainWindowViewModel.BuildRequestSummary(rows, preparedItems.Count));
            StatusText = "Review cases";
            var reviewWindow = new CaseReviewWindow(_backend, preparedItems, settings, AppendLog, _storage, reviewSessionId)
            {
                Owner = this
            };
            if (reviewWindow.ShowDialog() != true || reviewWindow.ApprovedItems.Count == 0)
            {
                StatusText = "Review cancelled";
                return;
            }

            AppendLog(MainWindowViewModel.BuildExportSummary(reviewWindow.ApprovedItems));

            var stdout = await _jobs.RunAsync(
                "Creating PowerPoint...",
                OnJobChanged,
                token => _backend.RenderAsync(reviewWindow.ApprovedItems, settings, AppendLog, token));
            var outputPath = PowerPointResultParser.ExtractOutputPath(stdout);
            var manifestPath = PowerPointResultParser.ExtractManifestPath(stdout);
            if (!string.IsNullOrWhiteSpace(outputPath))
            {
                _lastPowerPointPath = outputPath;
                LastPowerPointText = $"Last PowerPoint: {Path.GetFileName(outputPath)}";
                _storage.SaveGeneratedPowerPoint(settings, outputPath, manifestPath, reviewWindow.ApprovedItems.Count);
                _storage.MarkReviewSessionExported(reviewSessionId, outputPath, reviewWindow.ApprovedItems.Count);
                if (settings.AutoOpen)
                {
                    OpenPath(outputPath);
                }
            }

            StatusText = "PowerPoint complete";
            AppendLog("PowerPoint created successfully.");
        }
        catch (OperationCanceledException)
        {
            StatusText = "Cancelled";
            AppendLog("Task cancelled.");
        }
        catch (Exception exception)
        {
            StatusText = "Error";
            AppendLog(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void ImportPdfs_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "PDF files (*.pdf)|*.pdf|All files (*.*)|*.*",
            Multiselect = true
        };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        try
        {
            SelectTab(MainTab.Activity);
            var domain = AppOptions.BoardDomainCliValue(BoardDomainCombo.SelectedItem?.ToString() ?? "");
            await _jobs.RunAsync(
                "Importing PDFs...",
                OnJobChanged,
                async token =>
                {
                    await _backend.ImportCoreReviewPdfsAsync(dialog.FileNames, domain, AppendLog, token);
                    return true;
                });
            _storage.SaveCoreSourceImports(dialog.FileNames, domain);
            BoardStatusText.Text = $"Imported {dialog.FileNames.Length} PDF(s).";
            StatusText = "Core Boards import complete";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Cancelled";
        }
        catch (Exception exception)
        {
            StatusText = "Import error";
            AppendLog(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        _jobs.Cancel();
        _backend.CancelCurrentProcess();
        StatusText = "Cancelling...";
    }

    private void OpenBoardFolder_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_backend.BoardReviewDir);
        OpenPath(_backend.BoardReviewDir);
    }

    private void OpenLastPowerPoint_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_lastPowerPointPath) && File.Exists(_lastPowerPointPath))
        {
            OpenPath(_lastPowerPointPath);
            return;
        }

        MessageBox.Show(this, "No generated PowerPoint has been found yet.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void OpenOutputs_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_backend.OutputsDir);
        OpenPath(_backend.OutputsDir);
    }

    private void OpenStateFolder_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_backend.StateDir);
        OpenPath(_backend.StateDir);
    }

    private void RefreshDiagnostics_Click(object sender, RoutedEventArgs e) => RefreshDiagnostics();

    private void RefreshLibrary_Click(object sender, RoutedEventArgs e) => RefreshLibrary();

    private void OpenLibraryCase_Click(object sender, RoutedEventArgs e)
    {
        if (LibraryGrid.SelectedItem is not CaseLibraryItem item)
        {
            MessageBox.Show(this, "Select a library case first.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        OpenPath(item.CaseUrl);
    }

    private void CleanScratch_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var result = _storage.CleanScratch();
            AppendLog($"Cleaned scratch: {result.RemovedFiles} file(s), {FormatBytes(result.RemovedBytes)} removed.");
            RefreshDiagnostics();
        }
        catch (Exception exception)
        {
            AppendLog(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void CleanOldCache_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var result = _storage.CleanOldCache(TimeSpan.FromDays(30));
            AppendLog($"Cleaned cache files older than 30 days: {result.RemovedFiles} file(s), {FormatBytes(result.RemovedBytes)} removed.");
            RefreshDiagnostics();
        }
        catch (Exception exception)
        {
            AppendLog(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void RunMaintenance_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var result = _storage.RunMaintenance();
            AppendLog(
                "Maintenance complete: " +
                $"{result.Scratch.RemovedFiles} scratch file(s), " +
                $"{result.Cache.RemovedFiles} old cache file(s), " +
                $"database now {FormatBytes(result.DatabaseBytes)}.");
            RefreshDiagnostics();
        }
        catch (Exception exception)
        {
            AppendLog(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private GenerationSettings BuildSettings()
    {
        return _viewModel.BuildSettings(new PowerPointSettingsSnapshot(
            TitleBox.Text,
            ImagesPerCaseBox.Text,
            OutputBox.Text,
            AutoOpenCheck.IsChecked == true,
            ClinicalHistoryCheck.IsChecked == true,
            OllamaCheck.IsChecked == true,
            OllamaModelCombo.Text,
            ThemeCombo.SelectedItem?.ToString() ?? "",
            PowerPointStyleCombo.SelectedItem?.ToString() ?? "",
            TeachingPointsCheck.IsChecked == true,
            OnlyNewRandomCheck.IsChecked == true));
    }

    private void SetBusy(bool busy)
    {
        GenerateButton.IsEnabled = !busy;
        CancelButton.IsEnabled = busy;
        Progress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnJobChanged(AppJobSnapshot job)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (job.Status == AppJobStatus.Running)
            {
                SetBusy(true);
                StatusText = job.Name;
                _storage.RecordEvent("info", $"Started: {job.Name}", job.Id);
                return;
            }

            SetBusy(false);
            StatusText = job.Status switch
            {
                AppJobStatus.Completed => "Ready",
                AppJobStatus.Cancelled => "Cancelled",
                AppJobStatus.Failed => "Error",
                _ => StatusText
            };
            _storage.RecordEvent(job.Status == AppJobStatus.Failed ? "error" : "info", $"{job.Status}: {job.Name}", job.Id);
        });
    }

    private void AppendLog(string message)
    {
        _storage.RecordEvent("info", "Activity", message);
        Dispatcher.BeginInvoke(() =>
        {
            ActivityLogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
            ActivityLogBox.ScrollToEnd();
        });
    }

    private void RefreshDiagnostics()
    {
        try
        {
            var diagnostics = _storage.GetDiagnostics();
            var counts = string.Join(", ", diagnostics.Counts.Select(pair => $"{pair.Key}: {pair.Value}"));
            var recentEvents = diagnostics.RecentEvents.Count == 0
                ? "No recent events."
                : string.Join(Environment.NewLine, diagnostics.RecentEvents.Take(5).Select(item => $"{item.CreatedAt} [{item.Level}] {item.Message}"));
            var recentJobs = diagnostics.RecentBackendJobs.Count == 0
                ? "No recent backend jobs."
                : string.Join(Environment.NewLine, diagnostics.RecentBackendJobs.Select(item =>
                {
                    var seconds = item.DurationMs / 1000.0;
                    var suffix = string.IsNullOrWhiteSpace(item.Error) ? "" : $" - {item.Error}";
                    return $"{item.UpdatedAt} [{item.Status}] {item.Command} ({seconds:0.0}s){suffix}";
                }));
            DiagnosticsText.Text =
                $"Database: {diagnostics.DatabasePath} ({FormatBytes(diagnostics.DatabaseBytes)}){Environment.NewLine}" +
                $"Cache: {FormatBytes(diagnostics.CacheBytes)} | Scratch: {FormatBytes(diagnostics.ScratchBytes)} | Outputs: {FormatBytes(diagnostics.OutputBytes)}{Environment.NewLine}" +
                $"Rows: {counts}{Environment.NewLine}" +
                $"Recent backend jobs: {recentJobs}{Environment.NewLine}" +
                $"Recent: {recentEvents}";
        }
        catch (Exception exception)
        {
            DiagnosticsText.Text = $"Diagnostics unavailable: {exception.Message}";
        }
    }

    private void RefreshLibrary()
    {
        try
        {
            var count = _library.Refresh(
                _storage,
                LibrarySearchBox.Text,
                LibraryDecisionFilter.SelectedItem?.ToString() ?? "All");
            StatusText = $"Library: {count} case(s)";
        }
        catch (Exception exception)
        {
            AppendLog(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void SelectTab(MainTab tab)
    {
        MainTabs.SelectedIndex = (int)tab;
    }

    private static void SetCheckBox(System.Windows.Controls.CheckBox checkBox, IReadOnlyDictionary<string, string> values, string key)
    {
        if (values.TryGetValue(key, out var value))
        {
            checkBox.IsChecked = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
        }
    }

    private static void SelectByCliValue(
        System.Windows.Controls.ComboBox comboBox,
        IEnumerable<string> labels,
        Func<string, string> toCliValue,
        IReadOnlyDictionary<string, string> values,
        string key)
    {
        if (!values.TryGetValue(key, out var savedValue))
        {
            return;
        }

        var match = labels.FirstOrDefault(label => toCliValue(label).Equals(savedValue, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(match))
        {
            comboBox.SelectedItem = match;
        }
    }

    private static void SelectComboByCliValue(
        System.Windows.Controls.ComboBox comboBox,
        IEnumerable<string> labels,
        Func<string, string> toCliValue,
        string cliValue)
    {
        var match = labels.FirstOrDefault(label => toCliValue(label).Equals(cliValue, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(match))
        {
            comboBox.SelectedItem = match;
        }
    }

    private static void OpenPath(string path)
    {
        Process.Start(new ProcessStartInfo(path)
        {
            UseShellExecute = true
        });
    }

    private static string Slugify(string value)
    {
        var slug = Regex.Replace(value.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "radiology-cases" : slug;
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        var value = (double)Math.Max(0, bytes);
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit += 1;
        }
        return $"{value:0.##} {units[unit]}";
    }

    private void BackendHealth_StatusChanged(object? sender, string message)
    {
        Dispatcher.BeginInvoke(() => StatusText = message);
    }

    protected override async void OnClosed(EventArgs e)
    {
        await _healthMonitor.StopAsync();
        _healthMonitor.Dispose();
        base.OnClosed(e);
    }
}
