using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using Microsoft.Win32;

namespace RadiologyPpt.App;

public partial class MainWindow : Window, INotifyPropertyChanged
{
    private readonly BackendClient _backend = new();
    private readonly AppStorage _storage;
    private readonly AppJobRunner _jobs = new();
    private readonly CaseLibraryViewModel _library = new();
    private string _statusText = "Ready";
    private string _lastPowerPointText = "No PowerPoint generated yet";
    private string _lastPowerPointPath = "";

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<CaseRequestRow> Requests { get; } = [];

    public string StatusText
    {
        get => _statusText;
        set => SetField(ref _statusText, value);
    }

    public string LastPowerPointText
    {
        get => _lastPowerPointText;
        set => SetField(ref _lastPowerPointText, value);
    }

    public MainWindow()
    {
        InitializeComponent();
        _storage = new AppStorage(_backend.StateDir, _backend.AppRoot);
        DataContext = this;
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
        InitialCropCombo.ItemsSource = AppOptions.CropModes;
        InitialCropCombo.SelectedIndex = 0;
        InitialMarkupCombo.ItemsSource = AppOptions.MarkupStyles;
        InitialMarkupCombo.SelectedIndex = 0;
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
            SelectByCliValue(ThemeCombo, AppOptions.Themes, AppOptions.ThemeCliValue, values, "theme");
            SelectByCliValue(PowerPointStyleCombo, AppOptions.PowerPointStyles, AppOptions.PowerPointStyleCliValue, values, "powerpoint_style");
            SelectByCliValue(InitialCropCombo, AppOptions.CropModes, AppOptions.CropCliValue, values, "crop_mode");
            SelectByCliValue(InitialMarkupCombo, AppOptions.MarkupStyles, AppOptions.MarkupCliValue, values, "markup_style");
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
        SelectComboByCliValue(InitialCropCombo, AppOptions.CropModes, AppOptions.CropCliValue, preset.CropMode);
        SelectComboByCliValue(InitialMarkupCombo, AppOptions.MarkupStyles, AppOptions.MarkupCliValue, preset.MarkupStyle);
        ClinicalHistoryCheck.IsChecked = preset.UseClinicalHistory;
        OllamaCheck.IsChecked = preset.UseOllamaReview;
        TeachingPointsCheck.IsChecked = preset.IncludeTeachingPoints;
        StatusText = $"Applied preset: {preset.Name}";
    }

    private async void Generate_Click(object sender, RoutedEventArgs e)
    {
        var settings = BuildSettings();
        var rows = Requests.Where(IsUsableRow).ToArray();
        if (rows.Length == 0)
        {
            MessageBox.Show(this, "Add at least one diagnosis, random case, or manual Radiopaedia case URL first.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var requests = rows.Select((row, index) => row.ToPayload(index + 1, settings)).ToList();
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
            var preparedItems = ReadItems(prepared);
            var failures = ReadFailures(prepared);
            foreach (var failure in failures)
            {
                AppendLog($"Warning: {failure}");
            }

            if (preparedItems.Count == 0)
            {
                MessageBox.Show(this, BuildFailureMessage(failures), Title, MessageBoxButton.OK, MessageBoxImage.Warning);
                StatusText = "No cases prepared";
                return;
            }

            reviewSessionId = _storage.CreateReviewSession(prepared, BuildRequestSummary(rows, preparedItems.Count));
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
            MessageBox.Show(this, "PowerPoint created successfully.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
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

    private void OpenProject_Click(object sender, RoutedEventArgs e) => OpenPath(_backend.ProjectRoot);

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
        var imagesPerCase = 3;
        if (int.TryParse(ImagesPerCaseBox.Text, out var parsed))
        {
            imagesPerCase = Math.Max(1, Math.Min(8, parsed));
        }

        return new GenerationSettings
        {
            Title = TitleBox.Text.Trim(),
            ImagesPerCase = imagesPerCase,
            OutputPath = OutputBox.Text.Trim(),
            AutoOpen = AutoOpenCheck.IsChecked == true,
            UseClinicalHistory = ClinicalHistoryCheck.IsChecked == true,
            UseOllamaReview = OllamaCheck.IsChecked == true,
            OllamaModel = OllamaModelCombo.Text.Trim(),
            Theme = AppOptions.ThemeCliValue(ThemeCombo.SelectedItem?.ToString() ?? ""),
            PowerPointStyle = AppOptions.PowerPointStyleCliValue(PowerPointStyleCombo.SelectedItem?.ToString() ?? ""),
            CropMode = AppOptions.CropCliValue(InitialCropCombo.SelectedItem?.ToString() ?? ""),
            MarkupStyle = AppOptions.MarkupCliValue(InitialMarkupCombo.SelectedItem?.ToString() ?? ""),
            IncludeTeachingPoints = TeachingPointsCheck.IsChecked == true
        };
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
        Dispatcher.BeginInvoke(() =>
        {
            ActivityLogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
            ActivityLogBox.ScrollToEnd();
        });
    }

    private static bool IsUsableRow(CaseRequestRow row)
    {
        if (row.Mode == AppOptions.RequestModes[1])
        {
            return row.Count > 0;
        }
        return !string.IsNullOrWhiteSpace(row.Query);
    }

    private static List<JsonObject> ReadItems(JsonObject prepared)
    {
        return prepared["items"]?.AsArray()
            .Select(node => node?.DeepClone().AsObject())
            .Where(item => item is not null)
            .Cast<JsonObject>()
            .ToList()
            ?? [];
    }

    private static string[] ReadFailures(JsonObject prepared)
    {
        return prepared["failures"]?.AsArray()
            .Select(node => node?.GetValue<string>() ?? "")
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray()
            ?? [];
    }

    private static string BuildFailureMessage(string[] failures)
    {
        if (failures.Length == 0)
        {
            return "No usable cases were prepared. Try broader filters or a different request.";
        }
        return "No usable cases were prepared." + Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine, failures);
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
            DiagnosticsText.Text =
                $"Database: {diagnostics.DatabasePath} ({FormatBytes(diagnostics.DatabaseBytes)}){Environment.NewLine}" +
                $"Cache: {FormatBytes(diagnostics.CacheBytes)} | Scratch: {FormatBytes(diagnostics.ScratchBytes)} | Outputs: {FormatBytes(diagnostics.OutputBytes)}{Environment.NewLine}" +
                $"Rows: {counts}{Environment.NewLine}" +
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

    private static string BuildRequestSummary(IReadOnlyCollection<CaseRequestRow> rows, int preparedCount)
    {
        return $"{rows.Count} row(s), {preparedCount} prepared case(s)";
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

    private void SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
