# Prose components

Three containers, each holding only its own child tag.

## Cards

<Cards>

<Card title="Pagination" href="apidoc:page/pagination">
Walk a collection, one page at a time.
</Card>

<Card title="Create a pet" href="apidoc:createPet">
The write path, end to end.
</Card>

<Card title="Ghost page" href="apidoc:page/nowhere">
Nothing declares this slug.
</Card>

<Card title="Status" href="https://status.e2e.test">
An ordinary destination, left as written.
</Card>

</Cards>

## Steps

<Steps>

<Step title="Install">
```bash
npm i
```
</Step>

<Step title="Authenticate">
Put your key in the environment: `{{tenant}}`.
</Step>

<Step>
A step with no title is still a step.
</Step>

</Steps>

## Tabs

<Tabs>

<Tab label="Cloud">
Nothing to install.

> [!NOTE]
> A panel holds full markdown.
</Tab>

<Tab label="Self-hosted">
Run the container:

```bash
docker run e2e/api
```
</Tab>

</Tabs>

## Written inside a fence

A page documenting the syntax renders it literally:

````markdown
<Steps>

<Step title="Install">
npm i
</Step>

</Steps>
````

## Malformed

A card with no destination is not our token: the tag is dropped, the prose
survives.

<Cards>

<Card title="No destination">
Prose that must survive.
</Card>

</Cards>
