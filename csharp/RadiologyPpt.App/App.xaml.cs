using System.Configuration;
using System.Data;
using System.Runtime.InteropServices;
using System.Windows;

namespace RadiologyPpt.App;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    private const string AppUserModelId = "funwithcthulhu.RadiopaediaCasePowerPointBuilder";

    [DllImport("shell32.dll", SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string appID);

    protected override void OnStartup(StartupEventArgs e)
    {
        _ = SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
        base.OnStartup(e);
    }
}

