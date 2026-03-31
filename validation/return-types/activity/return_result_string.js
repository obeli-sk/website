// Tests for return_type = "result<string>" (ok = string, no err payload)
// call with action="ok" -> return "hello"
// call with action="throw_null" -> throw null (valid err variant, no payload)
// call with action="throw_string" -> throw "error" (FatalError)
export default function return_result_string(action) {
    if (action === "ok") {
        return "hello";
    } else if (action === "throw_null") {
        throw null;
    } else if (action === "throw_string") {
        throw "this should be a fatal error, not a retry";
    }
}
