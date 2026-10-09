Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::RootElement
foreach($taskId in @(23348,10332)){
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$taskId)
$elements=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
Write-Output "PID=$taskId AccessibleNodes=$($elements.Count)"
foreach($element in $elements){[pscustomobject]@{Name=$element.Current.Name;Type=$element.Current.ControlType.ProgrammaticName;AutomationId=$element.Current.AutomationId}}
}
