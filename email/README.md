# Order emails (free, Google Apps Script)

`Code.gs` emails customers about their orders from your Gmail, at no cost:

- **Order received:** order ID, items with photos, quantity and prices, total, address,
  payment and estimated delivery.
- **Every status change:** Farm Batching, Dispatched, Out for Delivery, Delivered and Cancelled,
  with the delivery timeline.
- **Payment updates:** UPI payment received, COD order confirmed.
- **Tracking details:** courier, AWB number and tracking link from the admin portal's
  "Shipment tracking" box.

It runs every 5 minutes, so emails arrive within about 5 minutes of the change. The website
can't trigger it, and each email is sent once (recorded in the order's `emailLog`).

## One-time setup (about 5 minutes)

Do this signed in as **shivduttchauhan2@gmail.com**, the account that owns the Firebase project.

1. Open https://script.google.com and click **New project**. Name it `CHEKORGANICS order emails`.
2. Replace everything in `Code.gs` with the contents of [`Code.gs`](Code.gs) from this folder.
3. Click **Project Settings** (⚙ on the left) and tick **Show "appsscript.json" manifest file in
   editor**. Back in the editor, open `appsscript.json` and replace it with
   [`appsscript.json`](appsscript.json) from this folder.
4. Click **Save** (💾). In the function dropdown at the top, choose **`setup`** and click **Run**.
5. Google asks for permission. Click **Review permissions**, choose your account, then
   **Advanced → Go to CHEKORGANICS order emails (unsafe) → Allow**. The warning appears because
   you wrote the script yourself. It needs to read and update orders in Firestore, send email
   as you, and run on a timer.
6. The log should say **"Order emails are on."** That's it.

To see the design, place a test order on the site, then run **`sendTestForLatestOrder`**. It
emails that order to you.

## Limits on the free plan

- Gmail sends up to **100 emails a day** from a free account. An order typically gets 4–6
  emails over its life. If the limit is reached, the remaining emails go out the next day.
- Emails come from your Gmail address. Customer replies go to `REPLY_TO` in `Code.gs`.

## If something doesn't work

- **"Cloud Firestore API has not been used in project …"**: open
  https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=chekorganics-live
  and click **Enable**, then run `setup` again.
- **Nothing is sent**: check **Executions** (▶ on the left) in the Apps Script editor for errors.
  Only orders placed or changed after `setup` was run are emailed.
- **To turn emails off**: open **Triggers** (⏰ on the left) and delete the
  `processOrderEmails` trigger.
