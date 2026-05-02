using System.Collections.ObjectModel;

namespace RadiologyPpt.App;

public sealed class CaseLibraryViewModel
{
    public ObservableCollection<CaseLibraryItem> Items { get; } = [];

    public int Refresh(AppStorage storage, string searchText, string decisionFilter)
    {
        Items.Clear();
        foreach (var item in storage.LoadCaseLibrary(searchText, decisionFilter))
        {
            Items.Add(item);
        }
        return Items.Count;
    }
}
