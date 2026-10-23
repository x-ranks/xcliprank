# twizou 自動ラベル Windows タスク登録修正1

Windows ScheduledTasks の `RunLevelEnum` は `Limited` / `Highest`。旧スクリプトの `LeastPrivilege` を `Limited` に修正した1ファイル更新です。ユーザーから提示された `New-ScheduledTaskPrincipal` エラーの箇所だけを変更します。定期タスク登録やラベル処理は、このパッチの適用だけでは開始しません。

PowerShellでZIPの展開先から実行します。

```powershell
node .\apply-task-fix1.cjs --check
node .\apply-task-fix1.cjs --apply
cd C:\Projects\xcliprank
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-auto-label-task.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-auto-label-task.ps1 -Install
```

適用成功は `TASK_SCRIPT_FIX1_APPLIED backup=...`、タスク登録成功は `TASK_REGISTERED name=TwizouAutoLabelLocal interval=3h`。元ファイルのSHA-256が想定外なら上書きしません。パッチの模擬適用・ロールバック・PowerShell構文検査済み。実ユーザーでのタスク登録は未実施です。

タスク登録前に戻す場合は、適用時に表示された実際のバックアップ先を指定します。

```powershell
node .\apply-task-fix1.cjs --rollback 'C:\Projects\xcliprank-local-backups\<実際のバックアップ名>'
```
