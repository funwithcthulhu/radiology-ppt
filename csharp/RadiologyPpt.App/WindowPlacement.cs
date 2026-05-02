using System.Windows;

namespace RadiologyPpt.App;

public static class WindowPlacement
{
    public static void ClampToVisibleWorkArea(Window window)
    {
        var workArea = SystemParameters.WorkArea;
        const double margin = 12;

        var maxWidth = Math.Max(window.MinWidth, workArea.Width - (margin * 2));
        var maxHeight = Math.Max(window.MinHeight, workArea.Height - (margin * 2));

        window.MaxWidth = maxWidth;
        window.MaxHeight = maxHeight;

        if (window.Width > maxWidth)
        {
            window.Width = maxWidth;
        }

        if (window.Height > maxHeight)
        {
            window.Height = maxHeight;
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
