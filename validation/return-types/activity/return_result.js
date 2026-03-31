// Tests for return_type = "result" (no payloads)
// call with action="ok" -> return ok
// call with action="throw_null" -> throw null (valid err variant)
// call with action="throw_string" -> throw "error" (should be a FatalError, NOT a retry)
export default function return_result(action) {
    if (action === "ok") {
        return; // undefined -> ok
    } else if (action === "throw_null") {
        throw null;
    } else if (action === "throw_string") {
        throw "this should be a fatal error, not a retry";
    }
}
