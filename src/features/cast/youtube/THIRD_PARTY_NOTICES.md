# Third-party notices

Small parts of this folder are ports (rewritten in this project's style, no package
dependency) of MIT-licensed code. NewPipe (GPLv3) was a design reference only for the
hidden-WebView PO token approach; none of its code is used.

## YouTube.js

- Source: https://github.com/LuanRT/YouTube.js (`main`, commit `77703faa19e0214735be8db905e262c9e4a43a63`).
- Ported:
  - `src/utils/javascript/matchers.ts` `nsigMatcher` (the shape of the n/sig URL wrapper in
    the player script) → `player-script.ts` `findNsigFunction` (a text match instead of an AST walk).
  - `src/utils/Utils.ts` `getNsigProcessorFn` (build a stream URL object, run its methods,
    read `n` back) → `engine-script.ts` `decipher`.
- License: MIT.

```
MIT License

Copyright (c) 2021 LuanRT

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## BgUtils

- Source: https://github.com/LuanRT/BgUtils (`main`, commit `f842f8a14435a35800ff469d315bb1a7e6d7a64a`).
- Ported:
  - `src/core/BotGuardClient.ts` (`load`, `snapshot`), `src/core/WebPoMinter.ts`
    (`create`, `mintAsWebsafeString`) and the base64 helpers of `src/utils/helpers.ts`
    → `engine-script.ts` `botguard`, `mint`, `base64ToU8`, `u8ToWebsafe`.
  - `src/utils/constants.ts`, `buildURL`/`getHeaders` of `src/utils/helpers.ts` and the
    GenerateIT answer layout of the examples → `po-token.ts`.
- License: MIT.

```
MIT License

Copyright (c) 2024 LuanRT

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
