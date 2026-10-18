# Store privacy answers for 0.7

What to change in each store's privacy / data-use form because of 0.7 (page errors and failed
requests, dictation, recorded steps, after crops, `webRequest`). [PRIVACY.md](../PRIVACY.md) is the
policy all three link to; publish it before submitting.

## Chrome Web Store (Developer Dashboard → Privacy)

- [ ] **Permission justification for `webRequest`** (new): *Used only to see which requests made by
      the developer's local development pages failed (status code or network error, and the URL
      without its query string), so a note can tell the developer's own coding agent what went wrong.
      Request and response bodies and headers are never read. Ordinary browsing is never recorded.*
- [ ] **Data usage → Website content**: stays ticked. Add that page errors and failed-request URLs
      are now part of it (redacted in the browser first).
- [ ] **Data usage → Web history**: tick it if the reviewer reads failed-request and recorded-step
      URLs as browsing history; they are local dev page URLs only, query strings removed.
- [ ] **Microphone / audio**: Pinpoint itself does not collect audio. Dictation uses the browser's
      own speech recognition, so Chrome sends the audio to Google's speech service, not to Pinpoint.
      Say so in the justification or reviewer notes.
- [ ] **Certifications** (unchanged, re-confirm): not sold, not transferred to third parties, used
      only for the single purpose, not used for creditworthiness or lending. Everything goes only to
      the bridge on 127.0.0.1 and from there to the developer's own coding agent.
- [ ] **Privacy policy URL**: same link; make sure it points at the updated PRIVACY.md.

## Microsoft Edge Partner Center (Properties → Privacy)

- [ ] Same package as Chrome, so the same answers: add the `webRequest` justification above.
- [ ] **"Does your extension access, collect or transmit personal information?"**: keep *Yes* (website
      content, with the local-only destination). Mention failed-request URLs and recorded steps.
- [ ] Note dictation audio is handled by the browser's own speech service, not by Pinpoint.
- [ ] **Privacy policy URL**: the updated PRIVACY.md.

## addons.mozilla.org (Developer Hub → Edit product page / submission)

- [ ] **Data collection**: the manifest now declares `websiteContent` and `browsingActivity`
      (required). Check the listing shows both. No dictation on Firefox, so no audio answer is needed.
- [ ] **Privacy policy**: paste or link the updated PRIVACY.md (it has the Firefox declaration
      paragraph).
- [ ] **Compatibility**: Firefox desktop 140+ only. No Firefox for Android (no `gecko_android`).
- [ ] **Source code**: not needed; nothing is minified or generated.
- [ ] **Reviewer notes**: paste the text below at the first manual submission.

### AMO reviewer notes

```
Pinpoint only talks to a bridge the developer runs on 127.0.0.1 (`npx -y pinpoint-bridge`). To test,
start it and open any http://localhost page. The code is not minified or generated, so no source
upload is needed. It declares websiteContent because the annotated element's HTML, text and
screenshot go to that local bridge and then to the developer's own coding agent, and
browsingActivity because a note can carry the URLs of failed requests and of recorded steps (local
development pages only, query strings removed, secrets redacted by extension/redact.js). Nothing is
sent to the developer of Pinpoint.
```
