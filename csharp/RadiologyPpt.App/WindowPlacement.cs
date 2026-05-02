using System.Windows;

namespace RadiologyPpt.App;

public static class WindowPlacement
{
    public static void ClampToVisibleWorkArea(Window window)
    {
        var workArea = SystemParameters.WorkArea;
        const double margin = 12;

        // Clamp only the restored launch size. Do not set MaxWidth/MaxHeight;
        // WPF uses those limits when maximizing, which would leave a desktop gap.
        var launchMaxWidth = Math.Max(window.MinWidth, workArea.Width - (margin * 2));
        var launchMaxHeight = Math.Max(window.MinHeight, workArea.Height - (margin * 2));

        if (window.Width > launchMaxWidth)
        {
            window.Width = launchMaxWidth;
        }

        if (window.Height > launchMaxHeight)
        {
            window.Height = launchMaxHeight;
        }

        var left = workArea.Left + ((workArea.Width - window.Width) / 2);
        var top = workArea.Top + ((workArea.Height - window.Height) / 2);

        window.Left = Clamp(left, workArea.Left + margin, workArea.Right - window.Width - margin);
        window.Top = Clamp(top, workArea.Top + margin, workArea.Bottom - window.Height - margin);
    }

    private static double Clamp(double value, double min, double max)
    {
        if (max < min)
        {
            return min;
        }

        return Math.Min(Math.Max(value, min), max);
    }
}
