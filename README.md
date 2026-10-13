# Due Today by Operation

Standalone Node.js version of the Fulcrum report. It shows Ready operations on jobs linked to open sales orders, due on or before the selected day. Rows are grouped by customer PO and can be filtered by work center and operation; past-due operations are highlighted. PO value totals use eligible sales-order part lines.

## Password access (no username)

The report uses a password-only sign-in screen. There is no username field or `APP_USERNAME` setting. Set `APP_PASSWORD` in Render to choose the password viewers must enter. Sessions are held in an HTTP-only, same-site cookie and expire after 12 hours. Password attempts are rate limited.

## Render deployment

1. Push this folder's contents to a GitHub repository. Keep the repository private.
2. In Render, create a Web Service from that repository, or use the included `render.yaml` Blueprint.
3. Set these environment variables in Render:
   - `APP_PASSWORD` — the report viewer password.
   - `FULCRUM_API_TOKEN` — a private Fulcrum API token with read access to the report data.
   - `FULCRUM_BASE_URL` — optional; defaults to `https://api.fulcrumpro.com`.
   - `FULCRUM_TIME_ZONE` — optional; defaults to the server's local zone. Use an IANA value such as `America/Denver` to align “today” with the shop.
4. Deploy. The Node server binds to `0.0.0.0` and uses Render's `PORT`; Render provides HTTPS for the service URL.

Build command: `npm install`  
Start command: `npm start`  
Health check: `/health`

## Local run

Requires Node.js 20 or newer. Copy `.env.example` to `.env`, replace both secrets, then run:

```sh
npm start
```

Open `http://localhost:4173`. The server reads `.env` automatically through the `dotenv` dependency.

## Fulcrum API calls

The server proxies these POST list endpoints and follows Fulcrum `Skip`/`Take` pagination in batches of 5,000:

- `/api/reporting/job-activity/list`
- `/api/jobs/list`
- `/api/sales-orders/list`
- `/api/work-centers/list`
- `/api/reporting/sales-order-lines/list`

The API token never reaches the browser. The password protects access to report data; the static HTML shell and `/health` endpoint remain available so the sign-in can load and Render can check service health.

Tailwind CSS loads from its public CDN. No report data is requested until a viewer has entered the password.
