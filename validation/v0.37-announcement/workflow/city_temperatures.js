// ffqn: myapp:weather/workflow.city-temperatures(cities: list<string>) -> result<string, string>
export default function city_temperatures(cities) {
    const handles = cities.map(city => {
        const joinSet = obelisk.createJoinSet({ name: sanitizeJoinSetName(city) });
        const execId = joinSet.submit("myapp:weather/activity.get-temperature", [city]);
        return { city, joinSet, execId };
    });
    const results = handles.map(({ city, joinSet, execId }) => {
        const response = joinSet.joinNext();
        if (!response.ok) throw `failed to fetch weather for ${city}`;
        return `${city}: ${obelisk.getResult(response.id).ok}`;
    });
    return results.join(", ");
}

function sanitizeJoinSetName(s) {
    return s.replace(/[^A-Za-z0-9\-\/]/g, "-");
}