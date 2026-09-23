# ══════════════════════════════════════════════════════════════════════════════
# ⚡ Dogar Sajji — RAW ESC/POS send to a locally-installed (USB) Windows printer
# ══════════════════════════════════════════════════════════════════════════════
# Sends a file's exact bytes to a printer queue using the RAW datatype via the
# Windows spooler API (OpenPrinter/StartDocPrinter/WritePrinter), bypassing GDI
# print rendering entirely. This is the standard technique (Microsoft KB322091)
# for delivering raw ESC/POS commands to a thermal printer through its normal
# Windows driver/queue instead of relying on Chrome's HTML print pipeline,
# which reformats content and can't reliably send exact control bytes (cut,
# bold, alignment) the way this app's network printer path does over TCP.
#
# Invoked by printer.js via: powershell -File printer-usb-helper.ps1 -PrinterName <name> -FilePath <path>
# Prints exactly one line to stdout: "OK" on success, or "ERROR: <reason>".

param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes, out string error)
    {
        error = "";
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Dogar Sajji Receipt";
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            error = "Could not open printer \"" + printerName + "\" (check the name matches exactly and it's installed)";
            return false;
        }
        try
        {
            if (!StartDocPrinter(hPrinter, 1, di)) { error = "StartDocPrinter failed"; return false; }
            try
            {
                if (!StartPagePrinter(hPrinter)) { error = "StartPagePrinter failed"; return false; }
                IntPtr pUnmanagedBytes = Marshal.AllocHGlobal(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written))
                    {
                        error = "WritePrinter failed";
                        return false;
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(pUnmanagedBytes);
                }
                EndPagePrinter(hPrinter);
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
            return true;
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
"@

try {
    if (-not (Test-Path -LiteralPath $FilePath)) {
        Write-Output "ERROR: print job file not found"
        exit 0
    }
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $err = ""
    $ok = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes, [ref]$err)
    if ($ok) {
        Write-Output "OK"
    } else {
        Write-Output "ERROR: $err"
    }
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
}
