# Speech fixtures

Both clips were synthesized for these tests on Windows 11 with its built-in SAPI voices (`System.Speech`), written as
16 kHz mono PCM, then encoded to Ogg Opus (32 kbit/s) with ffmpeg 8.1. No recorded human performance is involved.

| File | Text | Voice | Length | Text's license |
|---|---|---|---|---|
| `gettysburg.ogg` | `gettysburg.txt`: Abraham Lincoln's Gettysburg Address (Bliss copy, 1863) | Microsoft David Desktop (en-US) | 89.9 s | Public domain |
| `chinese.ogg` | `chinese.txt`: two plain sentences written for this test | Microsoft Huihui Desktop (zh-CN) | 14.3 s | Written for this repo |

The English clip is long enough for three window seams (windows start at 0, 26, 52 and 78 s); the Chinese clip checks
that the language is detected rather than assumed.

To regenerate a clip (PowerShell, then ffmpeg):

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft David Desktop')
$s.SetOutputToWaveFile("$PWD\gettysburg.wav", (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, 'Sixteen', 'Mono'))
$s.Speak([IO.File]::ReadAllText("$PWD\gettysburg.txt")); $s.Dispose()
ffmpeg -i gettysburg.wav -c:a libopus -b:a 32k -ac 1 -ar 16000 -application voip -map_metadata -1 gettysburg.ogg
```
