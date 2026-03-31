// Tests for return_type = "result<string, string>" (ok = string, err = string)
// call with action="ok" -> return "hello"
// call with action="throw_string" -> throw "something went wrong"
export default function return_result_string_string(action) {
    if (action === "ok") {
        return "hello";
    } else if (action === "throw_string") {
        throw "something went wrong";
    } else if (action === "throw_error_object") {
        throw new Error("an Error object");
    }
}
