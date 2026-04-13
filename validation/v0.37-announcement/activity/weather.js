// ffqn: myapp:weather/activity.get-temperature(city: string) -> result<string, string>
export default async function get_temperature(city) {
    const resp = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=%t`,
    );
    if (!resp.ok) throw `HTTP ${resp.status}`;
    return (await resp.text()).trim();
}
