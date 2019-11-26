"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_forge_1 = require("node-forge");
const SignPdfError_1 = require("../SignPdfError");
function getSignatureInfo(buffer, password) {
    var _a;
    try {
        const p12Buffer = buffer.toString('base64');
        const p12Der = node_forge_1.util.decode64(p12Buffer);
        const p12Asn1 = node_forge_1.asn1.fromDer(p12Der);
        const p12 = node_forge_1.pkcs12.pkcs12FromAsn1(p12Asn1, password || '');
        const bagkey = node_forge_1.pki.oids.pkcs8ShroudedKeyBag;
        const pkcs8Bags2 = p12.getBags({ bagType: bagkey });
        const keyObject = pkcs8Bags2[bagkey][0].key;
        const localKeyId = pkcs8Bags2[bagkey][0].attributes.localKeyId;
        const key = node_forge_1.pki.privateKeyToPem(keyObject);
        const certBags = p12.getBags({
            bagType: node_forge_1.pki.oids.certBag, localKeyId: localKeyId[0]
        });
        const cert = certBags.localKeyId[0].cert;
        return (_a = cert) === null || _a === void 0 ? void 0 : _a.subject.getField('CN').value;
    }
    catch (e) {
        throw new SignPdfError_1.SignPdfError(e.message, SignPdfError_1.ERROR_VERIFY_SIGNATURE);
    }
}
exports.getSignatureInfo = getSignatureInfo;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2V0U2lnbmF0dXJlSW5mby5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9oZWxwZXJzL2dldFNpZ25hdHVyZUluZm8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSwyQ0FBcUQ7QUFDckQsa0RBQXVFO0FBRXZFLFNBQWdCLGdCQUFnQixDQUFDLE1BQWMsRUFBRSxRQUFpQjs7SUFDaEUsSUFBSTtRQUNGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDNUMsTUFBTSxNQUFNLEdBQUcsaUJBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDeEMsTUFBTSxPQUFPLEdBQUcsaUJBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsTUFBTSxHQUFHLEdBQUcsbUJBQU0sQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLFFBQVEsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMzRCxNQUFNLE1BQU0sR0FBRyxnQkFBRyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQztRQUM1QyxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUF1QyxDQUFDO1FBQzFGLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFxQixDQUFDO1FBQzlELE1BQU0sVUFBVSxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDO1FBQy9ELE1BQU0sR0FBRyxHQUFHLGdCQUFHLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzNDLE1BQU0sUUFBUSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUM7WUFDM0IsT0FBTyxFQUFFLGdCQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQztTQUNyRCxDQUFpQyxDQUFDO1FBQ25DLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQ3pDLGFBQU8sSUFBSSwwQ0FBRSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUM7S0FDM0M7SUFBQyxPQUFPLENBQUMsRUFBRTtRQUNWLE1BQU0sSUFBSSwyQkFBWSxDQUFDLENBQUMsQ0FBQyxPQUFPLEVBQUUscUNBQXNCLENBQUMsQ0FBQTtLQUMxRDtBQUNILENBQUM7QUFuQkQsNENBbUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXNuMSwgcGtjczEyLCBwa2ksIHV0aWwgfSBmcm9tICdub2RlLWZvcmdlJztcbmltcG9ydCB7IEVSUk9SX1ZFUklGWV9TSUdOQVRVUkUsIFNpZ25QZGZFcnJvciB9IGZyb20gJy4uL1NpZ25QZGZFcnJvcic7XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTaWduYXR1cmVJbmZvKGJ1ZmZlcjogQnVmZmVyLCBwYXNzd29yZD86IHN0cmluZykge1xuICB0cnkge1xuICAgIGNvbnN0IHAxMkJ1ZmZlciA9IGJ1ZmZlci50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgY29uc3QgcDEyRGVyID0gdXRpbC5kZWNvZGU2NChwMTJCdWZmZXIpO1xuICAgIGNvbnN0IHAxMkFzbjEgPSBhc24xLmZyb21EZXIocDEyRGVyKTtcbiAgICBjb25zdCBwMTIgPSBwa2NzMTIucGtjczEyRnJvbUFzbjEocDEyQXNuMSwgcGFzc3dvcmQgfHwgJycpO1xuICAgIGNvbnN0IGJhZ2tleSA9IHBraS5vaWRzLnBrY3M4U2hyb3VkZWRLZXlCYWc7XG4gICAgY29uc3QgcGtjczhCYWdzMiA9IHAxMi5nZXRCYWdzKHsgYmFnVHlwZTogYmFna2V5IH0pIGFzIHsgW2JhZ2tleTogc3RyaW5nXTogcGtjczEyLkJhZ1tdIH07XG4gICAgY29uc3Qga2V5T2JqZWN0ID0gcGtjczhCYWdzMltiYWdrZXldWzBdLmtleSBhcyBwa2kuUHJpdmF0ZUtleTtcbiAgICBjb25zdCBsb2NhbEtleUlkID0gcGtjczhCYWdzMltiYWdrZXldWzBdLmF0dHJpYnV0ZXMubG9jYWxLZXlJZDtcbiAgICBjb25zdCBrZXkgPSBwa2kucHJpdmF0ZUtleVRvUGVtKGtleU9iamVjdCk7XG4gICAgY29uc3QgY2VydEJhZ3MgPSBwMTIuZ2V0QmFncyh7XG4gICAgICBiYWdUeXBlOiBwa2kub2lkcy5jZXJ0QmFnLCBsb2NhbEtleUlkOiBsb2NhbEtleUlkWzBdXG4gICAgfSkgYXMgeyBsb2NhbEtleUlkOiBwa2NzMTIuQmFnW10gfTtcbiAgICBjb25zdCBjZXJ0ID0gY2VydEJhZ3MubG9jYWxLZXlJZFswXS5jZXJ0O1xuICAgIHJldHVybiBjZXJ0Py5zdWJqZWN0LmdldEZpZWxkKCdDTicpLnZhbHVlO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IFNpZ25QZGZFcnJvcihlLm1lc3NhZ2UsIEVSUk9SX1ZFUklGWV9TSUdOQVRVUkUpXG4gIH1cbn1cbiJdfQ==