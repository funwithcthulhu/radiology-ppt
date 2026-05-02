using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;

namespace RadiologyPpt.App;

public partial class CaseReviewWindow : Window
{
    private readonly BackendClient _backend;
    private readonly GenerationSettings _settings;
    private readonly Action<string> _log;
    private readonly AppStorage _storage;
    private readonly string _reviewSessionId;
    private readonly List<JsonObject> _items;
    private int _currentIndex;
    private CancellationTokenSource? _actionCancellation;

    public CaseReviewWindow(
        BackendClient backend,
        IReadOnlyList<JsonObject> preparedItems,
        GenerationSettings settings,
        Action<string> log,
        AppStorage storage,
        string reviewSessionId)
    {
        InitializeComponent();
        _backend = backend;
        _settings = settings;
        _log = log;
        _storage = storage;
        _reviewSessionId = reviewSessionId;
        _items = preparedItems.Select(item => item.DeepClone().AsObject()).ToList();
        CropCombo.ItemsSource = AppOptions.CropModes;
        CropCombo.SelectedItem = AppOptions.CropModes.FirstOrDefault(option => AppOptions.CropCliValue(option) == settings.CropMode) ?? AppOptions.CropModes[0];
        MarkupCombo.ItemsSource = AppOptions.MarkupStyles;
        MarkupCombo.SelectedItem = AppOptions.MarkupStyles.FirstOrDefault(option => AppOptions.MarkupCliValue(option) == settings.MarkupStyle) ?? AppOptions.MarkupStyles[0];
        ImagesBox.Text = settings.ImagesPerCase.ToString();
        ShowCurrentCase();
    }

    public ObservableCollection<ReviewImageItem> Images { get; } = [];
    public ObservableCollection<CandidateImageItem> CandidateImages { get; } = [];
    public List<JsonObject> ApprovedItems { get; } = [];

    private void Window_SourceInitialized(object? sender, EventArgs e)
    {
        WindowPlacement.ClampToVisibleWorkArea(this);
    }

    private void ShowCurrentCase()
    {
        if (_currentIndex >= _items.Count)
        {
            DialogResult = ApprovedItems.Count > 0;
            Close();
            return;
        }

        var item = _items[_currentIndex];
        var caseData = item["caseData"]?.AsObject();
        ProgressTitle.Text = $"Case Review {_currentIndex + 1} of {_items.Count}";
        CaseTitle.Text = TextValue(caseData, "caseTitle", "Prepared case");
        CaseIntro.Text = TextValue(caseData, "caseIntro", "Review the images, then keep, re-pick, reroll, or skip this case.");
        DetailsBox.Text = BuildDetailsText(item);

        Images.Clear();
        foreach (var image in caseData?["images"]?.AsArray() ?? [])
        {
            if (image is not JsonObject imageObject)
            {
                continue;
            }

            Images.Add(new ReviewImageItem
            {
                Keep = true,
                LocalPath = TextValue(imageObject, "localPath", ""),
                Caption = BuildImageCaption(imageObject),
                FrameId = TextValue(imageObject, "frameId", ""),
                Source = imageObject.DeepClone().AsObject()
            });
        }
        ImageItemsControl.ItemsSource = Images;
        LoadCandidateImages(caseData);
    }

    private void KeepNext_Click(object sender, RoutedEventArgs e)
    {
        ApplySelectedImagesToCurrentItem();
        var approved = _items[_currentIndex].DeepClone().AsObject();
        ApprovedItems.Add(approved);
        _storage.SaveCaseReview(_reviewSessionId, approved, "approved");
        _currentIndex += 1;
        ShowCurrentCase();
    }

    private void Skip_Click(object sender, RoutedEventArgs e)
    {
        _storage.SaveCaseReview(_reviewSessionId, _items[_currentIndex].DeepClone().AsObject(), "skipped");
        _currentIndex += 1;
        ShowCurrentCase();
    }

    private async void Reroll_Click(object sender, RoutedEventArgs e)
    {
        await RunReplacementActionAsync("Rerolling case...", async token =>
        {
            var request = CloneCurrentRequest();
            AddCurrentCaseToExclusions(request);
            var replacement = await _backend.PrepareSingleAsync(request, SettingsForReviewControls(), _log, token);
            if (replacement is null)
            {
                MessageBox.Show(this, "No alternate case was found for this request.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            _items[_currentIndex] = replacement;
            _storage.SaveImageCandidates(replacement["caseData"] as JsonObject);
            _storage.RecordEvent("info", "Rerolled review case", TextValue(replacement["caseData"] as JsonObject, "caseTitle", ""));
            ShowCurrentCase();
        });
    }

    private async void Repick_Click(object sender, RoutedEventArgs e)
    {
        await ReplaceImagesAsync(excludeCurrentImages: true, replaceUncheckedOnly: false);
    }

    private async void ReplaceUnchecked_Click(object sender, RoutedEventArgs e)
    {
        await ReplaceImagesAsync(excludeCurrentImages: true, replaceUncheckedOnly: true);
    }

    private async void UseSelectedCandidates_Click(object sender, RoutedEventArgs e)
    {
        var selectedCandidates = CandidateImages.Where(candidate => candidate.Use).ToArray();
        if (selectedCandidates.Length == 0)
        {
            MessageBox.Show(this, "Choose at least one candidate image first.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        await RunReplacementActionAsync("Fetching selected candidate images...", async token =>
        {
            var request = BuildSameCaseRequest(selectedCandidates.Length);
            request["includeFrameIds"] = new JsonArray(selectedCandidates.Select(candidate => JsonValue.Create(candidate.FrameId)).ToArray());
            var replacement = await _backend.PrepareSingleAsync(
                request,
                SettingsForReviewControls() with { ImagesPerCase = selectedCandidates.Length },
                _log,
                token);
            var replacementImages = replacement?["caseData"]?["images"]?.AsArray()
                .Select(node => node?.DeepClone().AsObject())
                .Where(image => image is not null)
                .Cast<JsonObject>()
                .ToList()
                ?? [];

            ReplaceCurrentImages(replacementImages);
            _storage.SaveImageCandidates(_items[_currentIndex]["caseData"] as JsonObject);
            if (replacementImages.Count < selectedCandidates.Length)
            {
                MessageBox.Show(this, "Some selected candidate frames could not be fetched, so only the available images were kept.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
            }
            ShowCurrentCase();
        });
    }

    private void RemoveUnchecked_Click(object sender, RoutedEventArgs e)
    {
        ApplySelectedImagesToCurrentItem();
        ShowCurrentCase();
    }

    private void CancelAction_Click(object sender, RoutedEventArgs e)
    {
        _actionCancellation?.Cancel();
        _backend.CancelCurrentProcess();
    }

    private void CancelReview_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private async Task ReplaceImagesAsync(bool excludeCurrentImages, bool replaceUncheckedOnly)
    {
        await RunReplacementActionAsync("Re-picking images...", async token =>
        {
            var checkedImages = Images.Where(image => image.Keep).Select(image => image.Source.DeepClone().AsObject()).ToList();
            var uncheckedCount = Images.Count(image => !image.Keep);
            var desiredCount = replaceUncheckedOnly ? uncheckedCount : Math.Max(1, ReadRequestedImageCount());
            if (replaceUncheckedOnly && uncheckedCount == 0)
            {
                MessageBox.Show(this, "Uncheck at least one image before replacing images.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var request = BuildSameCaseRequest(desiredCount);
            if (excludeCurrentImages)
            {
                request["excludeFrameIds"] = new JsonArray(Images.Select(image => JsonValue.Create(image.FrameId)).ToArray());
            }

            var replacement = await _backend.PrepareSingleAsync(request, SettingsForReviewControls() with { ImagesPerCase = desiredCount }, _log, token);
            var replacementImages = replacement?["caseData"]?["images"]?.AsArray()
                .Select(node => node?.DeepClone().AsObject())
                .Where(image => image is not null)
                .Cast<JsonObject>()
                .ToList()
                ?? [];

            if (replaceUncheckedOnly)
            {
                var combined = checkedImages.Concat(replacementImages).Take(Math.Max(checkedImages.Count, checkedImages.Count + uncheckedCount)).ToList();
            ReplaceCurrentImages(combined);
            _storage.SaveImageCandidates(_items[_currentIndex]["caseData"] as JsonObject);
            if (replacementImages.Count == 0)
            {
                    MessageBox.Show(this, "No alternate image was found for the unchecked slot, so that slot was left empty.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            else
            {
            ReplaceCurrentImages(replacementImages);
            _storage.SaveImageCandidates(_items[_currentIndex]["caseData"] as JsonObject);
            if (replacementImages.Count == 0)
            {
                    MessageBox.Show(this, "No alternate images were found for this case.", Title, MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }

            ShowCurrentCase();
        });
    }

    private async Task RunReplacementActionAsync(string status, Func<CancellationToken, Task> action)
    {
        SetActionBusy(true);
        _actionCancellation?.Dispose();
        _actionCancellation = new CancellationTokenSource();
        try
        {
            _log(status);
            await action(_actionCancellation.Token);
        }
        catch (OperationCanceledException)
        {
            _log("Review action cancelled.");
        }
        catch (Exception exception)
        {
            _log(exception.ToString());
            MessageBox.Show(this, exception.Message, Title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _actionCancellation.Dispose();
            _actionCancellation = null;
            SetActionBusy(false);
        }
    }

    private void SetActionBusy(bool busy)
    {
        BusyProgress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        CancelActionButton.IsEnabled = busy;
        RerollButton.IsEnabled = !busy;
        RepickButton.IsEnabled = !busy;
        ReplaceUncheckedButton.IsEnabled = !busy;
        KeepNextButton.IsEnabled = !busy;
    }

    private void ApplySelectedImagesToCurrentItem()
    {
        var keptImages = Images.Where(image => image.Keep).Select(image => image.Source.DeepClone()).ToArray();
        ReplaceCurrentImages(keptImages.Select(node => node.AsObject()).ToList());
    }

    private void ReplaceCurrentImages(IReadOnlyList<JsonObject> images)
    {
        var caseData = _items[_currentIndex]["caseData"]?.AsObject();
        if (caseData is null)
        {
            return;
        }

        caseData["images"] = new JsonArray(images.Select(image => image.DeepClone()).ToArray());
    }

    private JsonObject CloneCurrentRequest()
    {
        return _items[_currentIndex]["request"]?.DeepClone().AsObject() ?? new JsonObject();
    }

    private JsonObject BuildSameCaseRequest(int imageCount)
    {
        var request = CloneCurrentRequest();
        var caseData = _items[_currentIndex]["caseData"]?.AsObject();
        request["requestMode"] = "manual";
        request["selectedCasePath"] = TextValue(caseData, "casePath", "");
        request["selectedCaseTitle"] = TextValue(caseData, "caseTitle", "");
        request["diagnosis"] = TextValue(caseData, "caseTitle", TextValue(request, "diagnosis", ""));
        request["rawInput"] = TextValue(caseData, "caseTitle", TextValue(request, "rawInput", ""));
        request["requestedImagesPerCase"] = imageCount;
        request["cropMode"] = AppOptions.CropCliValue(CropCombo.SelectedItem?.ToString() ?? "");
        request["markupStyle"] = AppOptions.MarkupCliValue(MarkupCombo.SelectedItem?.ToString() ?? "");
        if (caseData?["imageCandidateBank"] is JsonArray candidateBank)
        {
            request["imageCandidateBank"] = candidateBank.DeepClone();
        }
        return request;
    }

    private void AddCurrentCaseToExclusions(JsonObject request)
    {
        var casePath = TextValue(_items[_currentIndex]["caseData"]?.AsObject(), "casePath", "");
        var exclusions = request["excludeCasePaths"] as JsonArray;
        if (exclusions is null)
        {
            exclusions = new JsonArray();
            request["excludeCasePaths"] = exclusions;
        }
        if (!string.IsNullOrWhiteSpace(casePath))
        {
            exclusions.Add(casePath);
        }
    }

    private GenerationSettings SettingsForReviewControls()
    {
        return _settings with
        {
            ImagesPerCase = ReadRequestedImageCount(),
            CropMode = AppOptions.CropCliValue(CropCombo.SelectedItem?.ToString() ?? ""),
            MarkupStyle = AppOptions.MarkupCliValue(MarkupCombo.SelectedItem?.ToString() ?? "")
        };
    }

    private int ReadRequestedImageCount()
    {
        return int.TryParse(ImagesBox.Text, out var parsed) ? Math.Max(1, Math.Min(8, parsed)) : _settings.ImagesPerCase;
    }

    private static string BuildDetailsText(JsonObject item)
    {
        var caseData = item["caseData"]?.AsObject();
        var quality = caseData?["quality"]?.AsObject();
        var warnings = quality?["warnings"]?.AsArray()
            .Select(node => node?.GetValue<string>() ?? "")
            .Where(value => !string.IsNullOrWhiteSpace(value));
        var builder = new StringBuilder();
        builder.AppendLine($"Title: {TextValue(caseData, "caseTitle", "")}");
        builder.AppendLine($"Source: {TextValue(caseData, "caseUrl", TextValue(caseData, "displayUrl", ""))}");
        builder.AppendLine($"Modality: {TextValue(caseData, "modalitySummary", "")}");
        builder.AppendLine($"Studies: {TextValue(caseData, "studyCount", "")}");
        builder.AppendLine($"Quality: {TextValue(quality, "summary", "")}");
        builder.AppendLine();
        builder.AppendLine("Warnings:");
        builder.AppendLine(string.Join(Environment.NewLine, warnings ?? []));
        builder.AppendLine();
        builder.AppendLine("Prompt:");
        builder.AppendLine(TextValue(caseData, "promptText", ""));
        return builder.ToString();
    }

    private static string BuildImageCaption(JsonObject image)
    {
        return string.Join(" | ", new[]
        {
            TextValue(image, "modality", ""),
            TextValue(image, "label", ""),
            TextValue(image, "plane", "")
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private void LoadCandidateImages(JsonObject? caseData)
    {
        CandidateImages.Clear();
        var selectedFrameIds = new HashSet<string>(Images.Select(image => image.FrameId), StringComparer.OrdinalIgnoreCase);
        var candidates = (caseData?["imageCandidateBank"] as JsonArray) ?? [];
        foreach (var image in candidates
            .OfType<JsonObject>()
            .Where(candidate => !selectedFrameIds.Contains(TextValue(candidate, "frameId", "")))
            .OrderByDescending(candidate => NumericValue(candidate, "relevantScore"))
            .Take(80))
        {
            var frameId = TextValue(image, "frameId", "");
            CandidateImages.Add(new CandidateImageItem
            {
                FrameId = frameId,
                PreviewPath = TextValue(image, "localPath", TextValue(image, "url", "")),
                Caption = BuildImageCaption(image),
                ScoreText = $"Frame {frameId} | score {NumericValue(image, "relevantScore"):0}",
                Source = image.DeepClone().AsObject()
            });
        }
        CandidateItemsControl.ItemsSource = CandidateImages;
    }

    private static string TextValue(JsonObject? node, string name, string fallback)
    {
        if (node is null || node[name] is null)
        {
            return fallback;
        }

        try
        {
            return node[name]!.ToString();
        }
        catch
        {
            return fallback;
        }
    }

    private static double NumericValue(JsonObject node, string name)
    {
        try
        {
            return node[name]?.GetValue<double>() ?? 0;
        }
        catch
        {
            return 0;
        }
    }
}

public sealed class ReviewImageItem : INotifyPropertyChanged
{
    private bool _keep = true;

    public event PropertyChangedEventHandler? PropertyChanged;

    public bool Keep
    {
        get => _keep;
        set
        {
            if (_keep == value)
            {
                return;
            }
            _keep = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Keep)));
        }
    }

    public string LocalPath { get; init; } = "";
    public string Caption { get; init; } = "";
    public string FrameId { get; init; } = "";
    public JsonObject Source { get; init; } = new();
}

public sealed class CandidateImageItem : INotifyPropertyChanged
{
    private bool _use;

    public event PropertyChangedEventHandler? PropertyChanged;

    public bool Use
    {
        get => _use;
        set
        {
            if (_use == value)
            {
                return;
            }
            _use = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Use)));
        }
    }

    public string PreviewPath { get; init; } = "";
    public string Caption { get; init; } = "";
    public string ScoreText { get; init; } = "";
    public string FrameId { get; init; } = "";
    public JsonObject Source { get; init; } = new();
}
