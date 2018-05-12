export default function renderFullPage(html) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>React App</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="stylesheet" type="text/css" href="/react-app/style.css" />
        </head>
        <body>
            <div id="root">${html}</div>
            <script src="/react-app/bundle.js"></script>
        </body>
        </html>
    `
};