$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Fixed program; all paths arrive as JSON data on stdin, never as PowerShell code.
function PrivateSecurity([bool]$directory) {
    if ($directory) { $security = New-Object System.Security.AccessControl.DirectorySecurity }
    else { $security = New-Object System.Security.AccessControl.FileSecurity }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $security.SetOwner($user)
    $security.SetAccessRuleProtection($true, $false)
    $inherit = [System.Security.AccessControl.InheritanceFlags]::None
    if ($directory) { $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
    foreach ($sid in @($user.Value, 'S-1-5-18', 'S-1-5-32-544')) {
        $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')
        $security.AddAccessRule($rule)
    }
    return $security
}
function CheckDirectory([string]$directory, [bool]$private) {
    $attributes = [System.IO.File]::GetAttributes($directory)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($attributes -band [System.IO.FileAttributes]::Directory) -eq 0) { throw 'Unsafe directory type' }
    $security = [System.IO.Directory]::GetAccessControl($directory)
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $user) { throw 'Unexpected directory owner' }
    if ($private) {
        if (-not $security.AreAccessRulesProtected) { throw 'Unprotected directory ACL' }
        $allowed = @($user, 'S-1-5-18', 'S-1-5-32-544')
        $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        foreach ($rule in $rules) {
            if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin $allowed -or $rule.IsInherited) { throw 'Unexpected ACL entry' }
        }
        foreach ($sid in $allowed) {
            if (-not ($rules | Where-Object { $_.IdentityReference.Value -eq $sid -and
                ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and
                ($_.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit') -eq [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' })) { throw 'Missing private ACL entry' }
        }
    }
}
function CheckFileSecurity($security) {
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $user -or
        -not $security.AreAccessRulesProtected) { throw 'Unsafe file ownership or ACL' }
    $allowed = @($user, 'S-1-5-18', 'S-1-5-32-544')
    $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin $allowed -or $rule.IsInherited) { throw 'Unexpected file ACL entry' }
    }
    foreach ($sid in $allowed) {
        if (-not ($rules | Where-Object { $_.IdentityReference.Value -eq $sid -and
            ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl })) { throw 'Missing file ACL entry' }
    }
}
function CheckParent([string]$directory) {
    CheckDirectory $directory $false
    $security = [System.IO.Directory]::GetAccessControl($directory)
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed = @($user, 'S-1-5-18', 'S-1-5-32-544')
    $write = [System.Security.AccessControl.FileSystemRights]'Write, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
    foreach ($rule in $security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed -and
            ($rule.FileSystemRights -band $write) -ne 0) { throw 'Shared-writable export parent' }
    }
}
function CheckRegular([string]$file) {
    $attributes = [System.IO.File]::GetAttributes($file)
    if (($attributes -band [System.IO.FileAttributes]'ReparsePoint, Directory') -ne 0) { throw 'Unsafe file type' }
}
function FullPath([string]$value) {
    if (-not [System.IO.Path]::IsPathRooted($value)) { throw 'Absolute path required' }
    return [System.IO.Path]::GetFullPath($value)
}
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -eq 'directory') {
        $directory = FullPath $request.path
        CheckParent ([System.IO.Path]::GetDirectoryName($directory))
        if ([System.IO.Directory]::Exists($directory)) {
            CheckDirectory $directory $false
            if ($request.create) { [System.IO.Directory]::SetAccessControl($directory, (PrivateSecurity $true)) }
        } elseif ($request.create) {
            [void][System.IO.Directory]::CreateDirectory($directory, (PrivateSecurity $true))
        } else { throw 'Directory missing' }
        CheckDirectory $directory $true
    } elseif ($request.action -eq 'file') {
        $file = FullPath $request.path
        CheckDirectory ([System.IO.Path]::GetDirectoryName($file)) $true
        CheckRegular $file
        $security = [System.IO.File]::GetAccessControl($file)
        if ($security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Unexpected file owner' }
        [System.IO.File]::SetAccessControl($file, (PrivateSecurity $false))
        CheckFileSecurity ([System.IO.File]::GetAccessControl($file))
    } elseif ($request.action -eq 'copy') {
        $source = FullPath $request.source
        $destination = FullPath $request.destination
        CheckRegular $source
        $inputFile = $null; $outputFile = $null
        try {
            # No delete-sharing: another process cannot remove the source during this copy.
            $inputFile = New-Object System.IO.FileStream($source, 'Open', 'Read', 'Read')
            try {
                # Apply the private DACL atomically at creation, before artwork is written.
                $outputFile = New-Object System.IO.FileStream($destination, [System.IO.FileMode]::CreateNew,
                    [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None,
                    1048576, [System.IO.FileOptions]::SequentialScan, (PrivateSecurity $false))
                CheckFileSecurity ($outputFile.GetAccessControl())
            } catch {
                $winError = $_.Exception.GetBaseException().HResult -band 0xffff
                if ($winError -notin @(80, 183)) { throw }
                if ($request.automatic) { [Console]::Out.Write('{"ok":false,"code":"EEXIST"}'); exit 0 }
                CheckRegular $destination
                # Open rather than replace the existing file, preserving its ACL.
                $outputFile = New-Object System.IO.FileStream($destination, 'Open', 'Write', 'None')
                $outputFile.SetLength(0)
            }
            $buffer = New-Object byte[] 1048576
            while (($count = $inputFile.Read($buffer, 0, $buffer.Length)) -gt 0) {
                if (-not (Get-Process -Id $request.parentPid -ErrorAction SilentlyContinue)) { throw 'Export owner exited' }
                $outputFile.Write($buffer, 0, $count)
            }
            $outputFile.Flush($true)
        } finally {
            if ($outputFile) { $outputFile.Dispose() }
            if ($inputFile) { $inputFile.Dispose() }
        }
    } else { throw 'Unknown private export operation' }
    [Console]::Out.Write('{"ok":true}')
} catch {
    [Console]::Out.Write('{"ok":false,"code":"EXPORT_PRIVATE_STORAGE"}')
    exit 1
}
