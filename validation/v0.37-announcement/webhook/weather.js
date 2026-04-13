// ffqn: myapp:weather/webhook.handle
export default async function handle(request) {
    const { cities } = await request.json();
    const execId = obelisk.executionIdGenerate();
    obelisk.schedule(execId, "myapp:weather/workflow.city-temperatures", [cities]);
    return Response.json({ execId }, { status: 202 });
}
