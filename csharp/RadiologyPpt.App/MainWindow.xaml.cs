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
    private CancellationTokenSource? _taskCancellation;
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
        DataContext = this;
        InitializeOptionControls();
        RequestsGrid.ItemsSource = Requests;
        Requests.Add(new CaseRequestRow());
        AppendLog("C# desktop app started.");
        AppendLog($"Project root: {_backend.ProjectRoot}");
        AppendLog($"Node runtime: {_backend.NodePath}");
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
        OllamaModelCombo.Text = "moondream";
    }

    private void CasesNav_Click(object sender, RoutedEventArgs e) => MainTabs.SelectedIndex = 0;
    private void CoreBoardsNav_Click(object sender, RoutedEventArgs e) => MainTabs.SelectedIndex = 1;
    private void PowerPointNav_Click(object sender, RoutedEventArgs e) => MainTabs.SelectedIndex = 2;
    private void ActivityNav_Click(object sender, RoutedEventArgs e) => MainTabs.SelectedIndex = 3;

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
        using var cancellation = BeginTask("Preparing cases...");
        try
        {
            MainTabs.SelectedIndex = 3;
            AppendLog($"Preparing {rows.Length} request row(s)...");
            var prepared = await _backend.PrepareAsync(requests, settings, AppendLog, cancellation.Token);
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

            StatusText = "Review cases";
            var reviewWindow = new CaseReviewWindow(_backend, preparedItems, settings, AppendLog)
            {
                Owner = this
            };
            if (reviewWindow.ShowDialog() != true || reviewWindow.ApprovedItems.Count == 0)
            {
                StatusText = "Review cancelled";
                return;
            }

            using var renderCancellation = BeginTask("Creating PowerPoint...");
            var stdout = await _backend.RenderAsync(reviewWindow.ApprovedItems, settings, AppendLog, renderCancellation.Token);
            var outputPath = ExtractOutputPath(stdout);
            if (!string.IsNullOrWhiteSpace(outputPath))
            {
                _lastPowerPointPath = outputPath;
                LastPowerPointText = $"Last PowerPoint: {Path.GetFileName(outputPath)}";
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
        finally
        {
            EndTask();
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

        using var cancellation = BeginTask("Importing PDFs...");
        try
        {
            MainTabs.SelectedIndex = 3;
            var domain = AppOptions.BoardDomainCliValue(BoardDomainCombo.SelectedItem?.ToString() ?? "");
            await _backend.ImportCoreReviewPdfsAsync(dialog.FileNames, domain, AppendLog, cancellation.Token);
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
        finally
        {
            EndTask();
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        _taskCancellation?.Cancel();
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

    private CancellationTokenSource BeginTask(string status)
    {
        _taskCancellation?.Dispose();
        _taskCancellation = new CancellationTokenSource();
        SetBusy(true);
        StatusText = status;
        return _taskCancellation;
    }

    private void EndTask()
    {
        SetBusy(false);
        _taskCancellation?.Dispose();
        _taskCancellation = null;
    }

    private void SetBusy(bool busy)
    {
        GenerateButton.IsEnabled = !busy;
        CancelButton.IsEnabled = busy;
        Progress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
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

    private static string ExtractOutputPath(string stdout)
    {
        var match = Regex.Match(stdout, @"Created PowerPoint:\s*(.+)", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value.Trim() : "";
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
