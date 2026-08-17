# Petstore API

Everything you need to buy, sell and track pets — and a live sandbox to try
every call without leaving the page.

> [!TIP]
> This page took over the landing route. The technical overview it displaced —
> stats, `llms.txt` exports, MCP config — is one click away under **API
> overview** in the navigation.

## Start here

```apidoc:operation
GET /pet/findByStatus
POST /pet
GET /store/inventory
```

## In three steps

<Steps>

<Step title="Pick an environment">
Choose **demo (mocked API)** in the header switcher.
</Step>

<Step title="Send a request">
Open [find pets by status](apidoc:findPetsByStatus) and press **Send**.
</Step>

<Step title="Iterate">
Read the response, then edit the parameters and send again.
</Step>

</Steps>

The API answering you runs **inside your browser**, in a service worker: no
backend, no CORS, and the data resets whenever the browser recycles it.

## Where to go next

<Cards>

<Card title="Getting started" href="apidoc:page/getting-started">
Authentication and your first request.
</Card>

<Card title="Pagination" href="apidoc:page/pagination">
Walk a collection without missing an item.
</Card>

<Card title="Errors" href="apidoc:page/errors">
What comes back when a call fails, and what to do about it.
</Card>

<Card title="Changelog" href="apidoc:page/changelog">
What moved between versions.
</Card>

</Cards>
