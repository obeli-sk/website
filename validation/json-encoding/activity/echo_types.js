// One function per type to verify JSON encoding round-trips.
export default function echo_types(
    a_bool,
    a_u32,
    a_string,
    an_option,   // option<string>
    a_list,      // list<u32>
) {
    return JSON.stringify({ a_bool, a_u32, a_string, an_option, a_list });
}
