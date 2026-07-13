// ffqn: myapp:weather/workflow.city-temperatures(cities: list<string>) -> result<string, string>
export default function city_temperatures(cities) {
    const handles = cities.map(city => {
        const joinSet = obelisk.createJoinSet({ name: sanitizeJoinSetName(city) });
        const execId = joinSet.submit("myapp:weather/activity.get-temperature", [city]);
        return { city, joinSet, execId };
    });
    const results = handles.map(({ city, joinSet, execId }) => {
        let temperature;
        try {
            temperature = joinSet.joinNext(); // ok value directly; throws on failure
        } catch (e) {
            throw `failed to fetch weather for ${city}`;
        }
        return `${city}: ${temperature}`;
    });
    return results.join(", ");
}

function sanitizeJoinSetName(s) {
    return s.replace(/[^A-Za-z0-9\-\/]/g, "-");
}