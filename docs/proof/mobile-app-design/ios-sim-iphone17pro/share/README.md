# Share on iOS

Rig: iPhone 17 Pro simulator, iOS 26.5, local keyless build of this branch.

`tonight-share-sheet.png`: the Tonight page's Share control opens the iOS share
sheet. WKWebView ships the Web Share API, so the page's own `navigator.share`
call reaches the OS picker with nothing from the shell in between. The sheet
names the page's own title and the origin (`localhost` here, the local rig;
`pubmaxxing.com` in the shipped binary).

The Android half is the defect: the Android System WebView has no Web Share
API, so the same control answered "Could not share tonight" there. See
`../../android-emu-pixel7/share/`.
