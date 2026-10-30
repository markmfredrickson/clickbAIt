# Uploading gig videos to YouTube

clickbAIt uploads a gig's finished videos to the band's channel through the YouTube Data API, using Google's official Node client (`googleapis`). This page covers the one-time setup, which only the channel's owner can do, and the limits that shape how uploads work.

## Limits to know first

- **New API projects can only upload private videos.** Uploads from a project created after July 28, 2020 are locked to private until the project passes Google's compliance audit ([videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)). Reports say a locked video stays locked after the audit and has to be uploaded again. So upload only test clips until the audit passes, and upload the finished videos after.
- **Quota.** A project gets 10,000 units a day. An upload costs 1,600 units in older guides and 100 in newer ones; either way a gig's videos fit in a day or two.
- **Sign-in expires weekly in Testing mode.** While the app's publishing status is Testing, Google's refresh tokens expire after 7 days and you sign in again. Moving the app to In production removes that limit.

## One-time setup

These steps use the Google Cloud console. The Cloud project can belong to any Google account you use; the channel's account only needs to be a test user. Google renames console pages often, so the names below may drift.

1. **Project.** Create a project in the [Cloud console](https://console.cloud.google.com/), for example `deermouse-uploads`.
2. **API.** In APIs & Services → Library, enable **YouTube Data API v3**.
3. **Consent screen.** Open [Google Auth Platform](https://console.cloud.google.com/auth) and click **Get started**. The wizard asks for an app name and support email, the audience (External), and a contact email.
   - **Test users:** under Audience, add the Google account that owns the channel. This can differ from the account that owns the Cloud project; for deermouse it is the band's own Gmail account.
   - **Data access:** we skipped adding the `youtube.upload` scope here. Whether a test user can sign in without it is not yet confirmed.
4. **Client.** In Google Auth Platform → Clients, create an OAuth client of type **Desktop app** and download its JSON. Save it as `~/.config/clickbait/youtube-client.json`. It is a secret: never put it in a repo.
5. **Audit.** Submit the [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form). It asks about the band, the API client and how it uses the API. The review takes weeks. See [Quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).

The first upload opens a browser to sign in, then saves a token at `~/.config/clickbait/youtube-token.json` so later uploads don't ask again.

This setup takes about half an hour and is too much to ask of every band. If clickbAIt ships with one audited client of its own, a new user would only need to sign in.

## Status, 2026-10-29

Steps 1–4 are done for deermouse. Signing in as the channel's account still fails with "Error 403: access_denied … can only be accessed by developer-approved testers", even after adding that account as a test user. Next to try: confirm the test user is saved in the right project, add the scope under Data access, or publish the app to In production. Step 5 (the audit) has not been submitted.
