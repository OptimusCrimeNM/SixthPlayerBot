export async function finalize(msg, obj) {
    console.trace("Finalized");
    return new Response(msg, obj);
}