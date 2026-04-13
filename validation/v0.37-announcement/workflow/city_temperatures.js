// ffqn: myapp:weather/workflow.city-temperatures(cities: list<string>) -> result<string, string>
export default function city_temperatures(cities) {
    const handles = cities.map(city => {
        const js = obelisk.createJoinSet();
        const execId = js.submit("myapp:weather/activity.get-temperature", [city]);
        return { city, js, execId };
    });
    const results = handles.map(({ city, js, execId }) => {
        const response = js.joinNext();
        if (!response.ok) throw `failed to fetch weather for ${city}`;
        return `${city}: ${obelisk.getResult(response.id).ok}`;
    });
    return results.join(", ");
}
