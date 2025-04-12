export async function finalize(msg, obj) {
    return new Response(msg, obj);
}

export function findBestPhotoSize(env, photo) {
    let coeff = function(photoSize){
        const maxSide = Math.max(photoSize.width, photoSize.height);
        if (maxSide > 768) return 0.5 * 768 / maxSide
        else return maxSide / 768;
    }

    photo.sort(function(a, b){ return coeff(a) > coeff(b) })
    return photo[0];
}