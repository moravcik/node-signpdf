"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_forge_1 = require("node-forge");
const SignPdfError_1 = require("./SignPdfError");
const helpers_1 = require("./helpers");
exports.DEFAULT_BYTE_RANGE_PLACEHOLDER = '**********';
class SignPdf {
    constructor() {
        this.lastSignature = null;
        this.byteRangePlaceholder = exports.DEFAULT_BYTE_RANGE_PLACEHOLDER;
    }
    sign(pdfBuffer, p12Buffer, additionalOptions = {}) {
        const options = {
            asn1StrictParsing: false,
            passphrase: '',
            ...additionalOptions,
        };
        if (!(pdfBuffer instanceof Buffer)) {
            throw new SignPdfError_1.SignPdfError('PDF expected as Buffer.', SignPdfError_1.ERROR_TYPE_INPUT);
        }
        if (!(p12Buffer instanceof Buffer)) {
            throw new SignPdfError_1.SignPdfError('p12 certificate expected as Buffer.', SignPdfError_1.ERROR_TYPE_INPUT);
        }
        let pdf = helpers_1.removeTrailingNewLine(pdfBuffer);
        // Find the ByteRange placeholder.
        const byteRangePlaceholder = [
            0,
            `/${this.byteRangePlaceholder}`,
            `/${this.byteRangePlaceholder}`,
            `/${this.byteRangePlaceholder}`,
        ];
        const byteRangeString = `/ByteRange [${byteRangePlaceholder.join(' ')}]`;
        const byteRangePos = pdf.indexOf(byteRangeString);
        if (byteRangePos === -1) {
            throw new SignPdfError_1.SignPdfError(`Could not find ByteRange placeholder: ${byteRangeString}`, SignPdfError_1.ERROR_TYPE_PARSE);
        }
        // Calculate the actual ByteRange that needs to replace the placeholder.
        const byteRangeEnd = byteRangePos + byteRangeString.length;
        const contentsTagPos = pdf.indexOf('/Contents ', byteRangeEnd);
        const placeholderPos = pdf.indexOf('<', contentsTagPos);
        const placeholderEnd = pdf.indexOf('>', placeholderPos);
        const placeholderLengthWithBrackets = (placeholderEnd + 1) - placeholderPos;
        const placeholderLength = placeholderLengthWithBrackets - 2;
        const byteRange = [0, 0, 0, 0];
        byteRange[1] = placeholderPos;
        byteRange[2] = byteRange[1] + placeholderLengthWithBrackets;
        byteRange[3] = pdf.length - byteRange[2];
        let actualByteRange = `/ByteRange [${byteRange.join(' ')}]`;
        actualByteRange += ' '.repeat(byteRangeString.length - actualByteRange.length);
        // Replace the /ByteRange placeholder with the actual ByteRange
        pdf = Buffer.concat([
            pdf.slice(0, byteRangePos),
            Buffer.from(actualByteRange),
            pdf.slice(byteRangeEnd),
        ]);
        // Remove the placeholder signature
        pdf = Buffer.concat([
            pdf.slice(0, byteRange[1]),
            pdf.slice(byteRange[2], byteRange[2] + byteRange[3]),
        ]);
        // Convert Buffer P12 to a forge implementation.
        const forgeCert = node_forge_1.util.createBuffer(p12Buffer.toString('binary'));
        const p12Asn1 = node_forge_1.asn1.fromDer(forgeCert);
        const p12 = node_forge_1.pkcs12.pkcs12FromAsn1(p12Asn1, options.asn1StrictParsing, options.passphrase);
        // Extract safe bags by type.
        // We will need all the certificates and the private key.
        const certBags = p12.getBags({
            bagType: node_forge_1.pki.oids.certBag,
        })[node_forge_1.pki.oids.certBag];
        const keyBags = p12.getBags({
            bagType: node_forge_1.pki.oids.pkcs8ShroudedKeyBag,
        })[node_forge_1.pki.oids.pkcs8ShroudedKeyBag];
        const privateKey = keyBags[0].key;
        // Here comes the actual PKCS#7 signing.
        const p7 = node_forge_1.pkcs7.createSignedData();
        // Start off by setting the content.
        p7.content = node_forge_1.util.createBuffer(pdf.toString('binary'));
        // Then add all the certificates (-cacerts & -clcerts)
        // Keep track of the last found client certificate.
        // This will be the public key that will be bundled in the signature.
        let certificate;
        certBags.forEach(bag => {
            const publicKey = bag.cert.publicKey;
            p7.addCertificate(bag.cert);
            // Try to find the certificate that matches the private key.
            if (privateKey.n.compareTo(publicKey.n) === 0
                && privateKey.e.compareTo(publicKey.e) === 0) {
                certificate = bag.cert;
            }
        });
        if (typeof certificate === 'undefined') {
            throw new SignPdfError_1.SignPdfError('Failed to find a certificate that matches the private key.', SignPdfError_1.ERROR_TYPE_INPUT);
        }
        // Add a sha256 signer. That's what Adobe.PPKLite adbe.pkcs7.detached expects.
        p7.addSigner({
            key: privateKey,
            certificate,
            digestAlgorithm: node_forge_1.pki.oids.sha256,
            authenticatedAttributes: [
                {
                    type: node_forge_1.pki.oids.contentType,
                    value: node_forge_1.pki.oids.data,
                }, {
                    type: node_forge_1.pki.oids.messageDigest,
                }, {
                    type: node_forge_1.pki.oids.signingTime,
                    // value can also be auto-populated at signing time
                    // We may also support passing this as an option to sign().
                    // Would be useful to match the creation time of the document for example.
                    value: new Date().toDateString(),
                },
            ],
        });
        // Sign in detached mode.
        p7.sign({ detached: true });
        // Check if the PDF has a good enough placeholder to fit the signature.
        const raw = node_forge_1.asn1.toDer(p7.toAsn1()).getBytes();
        // placeholderLength represents the length of the HEXified symbols but we're
        // checking the actual lengths.
        if ((raw.length * 2) > placeholderLength) {
            throw new SignPdfError_1.SignPdfError(`Signature exceeds placeholder length: ${raw.length * 2} > ${placeholderLength}`, SignPdfError_1.ERROR_TYPE_INPUT);
        }
        let signature = Buffer.from(raw, 'binary').toString('hex');
        // Store the HEXified signature. At least useful in tests.
        this.lastSignature = signature;
        // Pad the signature with zeroes so the it is the same length as the placeholder
        signature += Buffer
            .from(String.fromCharCode(0).repeat((placeholderLength / 2) - raw.length))
            .toString('hex');
        // Place it in the document.
        pdf = Buffer.concat([
            pdf.slice(0, byteRange[1]),
            Buffer.from(`<${signature}>`),
            pdf.slice(byteRange[1]),
        ]);
        // Magic. Done.
        return pdf;
    }
}
exports.SignPdf = SignPdf;
exports.default = new SignPdf();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2lnbnBkZi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9zaWducGRmLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsMkNBQTREO0FBQzVELGlEQUFrRjtBQUNsRix1Q0FBa0Q7QUFFckMsUUFBQSw4QkFBOEIsR0FBRyxZQUFZLENBQUM7QUFFM0QsTUFBYSxPQUFPO0lBQXBCO1FBRVcsa0JBQWEsR0FBa0IsSUFBSSxDQUFDO1FBQ25DLHlCQUFvQixHQUFHLHNDQUE4QixDQUFDO0lBK0tsRSxDQUFDO0lBN0tVLElBQUksQ0FDUCxTQUFpQixFQUNqQixTQUFpQixFQUNqQixpQkFBaUIsR0FBRyxFQUFFO1FBRXRCLE1BQU0sT0FBTyxHQUFHO1lBQ1osaUJBQWlCLEVBQUUsS0FBSztZQUN4QixVQUFVLEVBQUUsRUFBRTtZQUNkLEdBQUcsaUJBQWlCO1NBQ3ZCLENBQUM7UUFFRixJQUFJLENBQUMsQ0FBQyxTQUFTLFlBQVksTUFBTSxDQUFDLEVBQUU7WUFDaEMsTUFBTSxJQUFJLDJCQUFZLENBQ2xCLHlCQUF5QixFQUN6QiwrQkFBZ0IsQ0FDbkIsQ0FBQztTQUNMO1FBQ0QsSUFBSSxDQUFDLENBQUMsU0FBUyxZQUFZLE1BQU0sQ0FBQyxFQUFFO1lBQ2hDLE1BQU0sSUFBSSwyQkFBWSxDQUNsQixxQ0FBcUMsRUFDckMsK0JBQWdCLENBQ25CLENBQUM7U0FDTDtRQUVELElBQUksR0FBRyxHQUFHLCtCQUFxQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRTNDLGtDQUFrQztRQUNsQyxNQUFNLG9CQUFvQixHQUFHO1lBQ3pCLENBQUM7WUFDRCxJQUFJLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtZQUMvQixJQUFJLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtZQUMvQixJQUFJLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtTQUNsQyxDQUFDO1FBQ0YsTUFBTSxlQUFlLEdBQUcsZUFBZSxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcs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RS9CLGdGQUFnRjtRQUNoRixTQUFTLElBQUksTUFBTTthQUNkLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGlCQUFpQixHQUFHLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQzthQUN6RSxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFckIsNEJBQTRCO1FBQzVCLEdBQUcsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO1lBQ2hCLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMxQixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyxHQUFHLENBQUM7WUFDN0IsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDMUIsQ0FBQyxDQUFDO1FBRUgsZUFBZTtRQUNmLE9BQU8sR0FBRyxDQUFDO0lBQ2YsQ0FBQztDQUNKO0FBbExELDBCQWtMQztBQUVELGtCQUFlLElBQUksT0FBTyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBhc24xLCBwa2NzMTIsIHBrY3M3LCBwa2ksIHV0aWwgfSBmcm9tICdub2RlLWZvcmdlJztcbmltcG9ydCB7IEVSUk9SX1RZUEVfSU5QVVQsIEVSUk9SX1RZUEVfUEFSU0UsIFNpZ25QZGZFcnJvciB9IGZyb20gJy4vU2lnblBkZkVycm9yJztcbmltcG9ydCB7IHJlbW92ZVRyYWlsaW5nTmV3TGluZSB9IGZyb20gJy4vaGVscGVycyc7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX0JZVEVfUkFOR0VfUExBQ0VIT0xERVIgPSAnKioqKioqKioqKic7XG5cbmV4cG9ydCBjbGFzcyBTaWduUGRmIHtcblxuICAgIHB1YmxpYyBsYXN0U2lnbmF0dXJlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBwcml2YXRlIGJ5dGVSYW5nZVBsYWNlaG9sZGVyID0gREVGQVVMVF9CWVRFX1JBTkdFX1BMQUNFSE9MREVSO1xuXG4gICAgcHVibGljIHNpZ24oXG4gICAgICAgIHBkZkJ1ZmZlcjogQnVmZmVyLFxuICAgICAgICBwMTJCdWZmZXI6IEJ1ZmZlcixcbiAgICAgICAgYWRkaXRpb25hbE9wdGlvbnMgPSB7fSxcbiAgICApIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIGFzbjFTdHJpY3RQYXJzaW5nOiBmYWxzZSxcbiAgICAgICAgICAgIHBhc3NwaHJhc2U6ICcnLFxuICAgICAgICAgICAgLi4uYWRkaXRpb25hbE9wdGlvbnMsXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKCEocGRmQnVmZmVyIGluc3RhbmNlb2YgQnVmZmVyKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFNpZ25QZGZFcnJvcihcbiAgICAgICAgICAgICAgICAnUERGIGV4cGVjdGVkIGFzIEJ1ZmZlci4nLFxuICAgICAgICAgICAgICAgIEVSUk9SX1RZUEVfSU5QVVQsXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGlmICghKHAxMkJ1ZmZlciBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBTaWduUGRmRXJyb3IoXG4gICAgICAgICAgICAgICAgJ3AxMiBjZXJ0aWZpY2F0ZSBleHBlY3RlZCBhcyBCdWZmZXIuJyxcbiAgICAgICAgICAgICAgICBFUlJPUl9UWVBFX0lOUFVULFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBwZGYgPSByZW1vdmVUcmFpbGluZ05ld0xpbmUocGRmQnVmZmVyKTtcblxuICAgICAgICAvLyBGaW5kIHRoZSBCeXRlUmFuZ2UgcGxhY2Vob2xkZXIuXG4gICAgICAgIGNvbnN0IGJ5dGVSYW5nZVBsYWNlaG9sZGVyID0gW1xuICAgICAgICAgICAgMCxcbiAgICAgICAgICAgIGAvJHt0aGlzLmJ5dGVSYW5nZVBsYWNlaG9sZGVyfWAsXG4gICAgICAgICAgICBgLyR7dGhpcy5ieXRlUmFuZ2VQbGFjZWhvbGRlcn1gLFxuICAgICAgICAgICAgYC8ke3RoaXMuYnl0ZVJhbmdlUGxhY2Vob2xkZXJ9YCxcbiAgICAgICAgXTtcbiAgICAgICAgY29uc3QgYnl0ZVJhbmdlU3RyaW5nID0gYC9CeXRlUmFuZ2UgWyR7Ynl0ZVJhbmdlUGxhY2Vob2xkZXIuam9pbignICcpfV1gO1xuICAgICAgICBjb25zdCBieXRlUmFuZ2VQb3MgPSBwZGYuaW5kZXhPZihieXRlUmFuZ2VTdHJpbmcpO1xuICAgICAgICBpZiAoYnl0ZVJhbmdlUG9zID09PSAtMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFNpZ25QZGZFcnJvcihcbiAgICAgICAgICAgICAgICBgQ291bGQgbm90IGZpbmQgQnl0ZVJhbmdlIHBsYWNlaG9sZGVyOiAke2J5dGVSYW5nZVN0cmluZ31gLFxuICAgICAgICAgICAgICAgIEVSUk9SX1RZUEVfUEFSU0UsXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2FsY3VsYXRlIHRoZSBhY3R1YWwgQnl0ZVJhbmdlIHRoYXQgbmVlZHMgdG8gcmVwbGFjZSB0aGUgcGxhY2Vob2xkZXIuXG4gICAgICAgIGNvbnN0IGJ5dGVSYW5nZUVuZCA9IGJ5dGVSYW5nZVBvcyArIGJ5dGVSYW5nZVN0cmluZy5sZW5ndGg7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRzVGFnUG9zID0gcGRmLmluZGV4T2YoJy9Db250ZW50cyAnLCBieXRlUmFuZ2VFbmQpO1xuICAgICAgICBjb25zdCBwbGFjZWhvbGRlclBvcyA9IHBkZi5pbmRleE9mKCc8JywgY29udGVudHNUYWdQb3MpO1xuICAgICAgICBjb25zdCBwbGFjZWhvbGRlckVuZCA9IHBkZi5pbmRleE9mKCc+JywgcGxhY2Vob2xkZXJQb3MpO1xuICAgICAgICBjb25zdCBwbGFjZWhvbGRlckxlbmd0aFdpdGhCcmFja2V0cyA9IChwbGFjZWhvbGRlckVuZCArIDEpIC0gcGxhY2Vob2xkZXJQb3M7XG4gICAgICAgIGNvbnN0IHBsYWNlaG9sZGVyTGVuZ3RoID0gcGxhY2Vob2xkZXJMZW5ndGhXaXRoQnJhY2tldHMgLSAyO1xuICAgICAgICBjb25zdCBieXRlUmFuZ2UgPSBbMCwgMCwgMCwgMF07XG4gICAgICAgIGJ5dGVSYW5nZVsxXSA9IHBsYWNlaG9sZGVyUG9zO1xuICAgICAgICBieXRlUmFuZ2VbMl0gPSBieXRlUmFuZ2VbMV0gKyBwbGFjZWhvbGRlckxlbmd0aFdpdGhCcmFja2V0cztcbiAgICAgICAgYnl0ZVJhbmdlWzNdID0gcGRmLmxlbmd0aCAtIGJ5dGVSYW5nZVsyXTtcbiAgICAgICAgbGV0IGFjdHVhbEJ5dGVSYW5nZSA9IGAvQnl0ZVJhbmdlIFske2J5dGVSYW5nZS5qb2luKCcgJyl9XWA7XG4gICAgICAgIGFjdHVhbEJ5dGVSYW5nZSArPSAnICcucmVwZWF0KGJ5dGVSYW5nZVN0cmluZy5sZW5ndGggLSBhY3R1YWxCeXRlUmFuZ2UubGVuZ3RoKTtcblxuICAgICAgICAvLyBSZXBsYWNlIHRoZSAvQnl0ZVJhbmdlIHBsYWNlaG9sZGVyIHdpdGggdGhlIGFjdHVhbCBCeXRlUmFuZ2VcbiAgICAgICAgcGRmID0gQnVmZmVyLmNvbmNhdChbXG4gICAgICAgICAgICBwZGYuc2xpY2UoMCwgYnl0ZVJhbmdlUG9zKSxcbiAgICAgICAgICAgIEJ1ZmZlci5mcm9tKGFjdHVhbEJ5dGVSYW5nZSksXG4gICAgICAgICAgICBwZGYuc2xpY2UoYnl0ZVJhbmdlRW5kKSxcbiAgICAgICAgXSk7XG5cbiAgICAgICAgLy8gUmVtb3ZlIHRoZSBwbGFjZWhvbGRlciBzaWduYXR1cmVcbiAgICAgICAgcGRmID0gQnVmZmVyLmNvbmNhdChbXG4gICAgICAgICAgICBwZGYuc2xpY2UoMCwgYnl0ZVJhbmdlWzFdKSxcbiAgICAgICAgICAgIHBkZi5zbGljZShieXRlUmFuZ2VbMl0sIGJ5dGVSYW5nZVsyXSArIGJ5dGVSYW5nZVszXSksXG4gICAgICAgIF0pO1xuXG4gICAgICAgIC8vIENvbnZlcnQgQnVmZmVyIFAxMiB0byBhIGZvcmdlIGltcGxlbWVudGF0aW9uLlxuICAgICAgICBjb25zdCBmb3JnZUNlcnQgPSB1dGlsLmNyZWF0ZUJ1ZmZlcihwMTJCdWZmZXIudG9TdHJpbmcoJ2JpbmFyeScpKTtcbiAgICAgICAgY29uc3QgcDEyQXNuMSA9IGFzbjEuZnJvbURlcihmb3JnZUNlcnQpO1xuICAgICAgICBjb25zdCBwMTIgPSBwa2NzMTIucGtjczEyRnJvbUFzbjEoXG4gICAgICAgICAgICBwMTJBc24xLFxuICAgICAgICAgICAgb3B0aW9ucy5hc24xU3RyaWN0UGFyc2luZyxcbiAgICAgICAgICAgIG9wdGlvbnMucGFzc3BocmFzZSxcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBFeHRyYWN0IHNhZmUgYmFncyBieSB0eXBlLlxuICAgICAgICAvLyBXZSB3aWxsIG5lZWQgYWxsIHRoZSBjZXJ0aWZpY2F0ZXMgYW5kIHRoZSBwcml2YXRlIGtleS5cbiAgICAgICAgY29uc3QgY2VydEJhZ3MgPSBwMTIuZ2V0QmFncyh7XG4gICAgICAgICAgICBiYWdUeXBlOiBwa2kub2lkcy5jZXJ0QmFnLFxuICAgICAgICB9KVtwa2kub2lkcy5jZXJ0QmFnXSBhcyBwa2NzMTIuQmFnW107XG4gICAgICAgIGNvbnN0IGtleUJhZ3MgPSBwMTIuZ2V0QmFncyh7XG4gICAgICAgICAgICBiYWdUeXBlOiBwa2kub2lkcy5wa2NzOFNocm91ZGVkS2V5QmFnLFxuICAgICAgICB9KVtwa2kub2lkcy5wa2NzOFNocm91ZGVkS2V5QmFnXSBhcyBwa2NzMTIuQmFnW107XG5cbiAgICAgICAgY29uc3QgcHJpdmF0ZUtleSA9IGtleUJhZ3NbMF0ua2V5IGFzIGFueTtcblxuICAgICAgICAvLyBIZXJlIGNvbWVzIHRoZSBhY3R1YWwgUEtDUyM3IHNpZ25pbmcuXG4gICAgICAgIGNvbnN0IHA3ID0gcGtjczcuY3JlYXRlU2lnbmVkRGF0YSgpO1xuICAgICAgICAvLyBTdGFydCBvZmYgYnkgc2V0dGluZyB0aGUgY29udGVudC5cbiAgICAgICAgcDcuY29udGVudCA9IHV0aWwuY3JlYXRlQnVmZmVyKHBkZi50b1N0cmluZygnYmluYXJ5JykpO1xuXG4gICAgICAgIC8vIFRoZW4gYWRkIGFsbCB0aGUgY2VydGlmaWNhdGVzICgtY2FjZXJ0cyAmIC1jbGNlcnRzKVxuICAgICAgICAvLyBLZWVwIHRyYWNrIG9mIHRoZSBsYXN0IGZvdW5kIGNsaWVudCBjZXJ0aWZpY2F0ZS5cbiAgICAgICAgLy8gVGhpcyB3aWxsIGJlIHRoZSBwdWJsaWMga2V5IHRoYXQgd2lsbCBiZSBidW5kbGVkIGluIHRoZSBzaWduYXR1cmUuXG4gICAgICAgIGxldCBjZXJ0aWZpY2F0ZTtcbiAgICAgICAgY2VydEJhZ3MuZm9yRWFjaChiYWcgPT4ge1xuICAgICAgICAgICAgY29uc3QgcHVibGljS2V5ID0gKGJhZy5jZXJ0IGFzIHBraS5DZXJ0aWZpY2F0ZSkucHVibGljS2V5IGFzIHBraS5yc2EuUHVibGljS2V5O1xuXG4gICAgICAgICAgICBwNy5hZGRDZXJ0aWZpY2F0ZShiYWcuY2VydCBhcyBwa2kuQ2VydGlmaWNhdGUpO1xuXG4gICAgICAgICAgICAvLyBUcnkgdG8gZmluZCB0aGUgY2VydGlmaWNhdGUgdGhhdCBtYXRjaGVzIHRoZSBwcml2YXRlIGtleS5cbiAgICAgICAgICAgIGlmIChwcml2YXRlS2V5Lm4uY29tcGFyZVRvKHB1YmxpY0tleS5uKSA9PT0gMFxuICAgICAgICAgICAgICAgICYmIHByaXZhdGVLZXkuZS5jb21wYXJlVG8ocHVibGljS2V5LmUpID09PSAwXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZSA9IGJhZy5jZXJ0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodHlwZW9mIGNlcnRpZmljYXRlID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFNpZ25QZGZFcnJvcihcbiAgICAgICAgICAgICAgICAnRmFpbGVkIHRvIGZpbmQgYSBjZXJ0aWZpY2F0ZSB0aGF0IG1hdGNoZXMgdGhlIHByaXZhdGUga2V5LicsXG4gICAgICAgICAgICAgICAgRVJST1JfVFlQRV9JTlBVVCxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgYSBzaGEyNTYgc2lnbmVyLiBUaGF0J3Mgd2hhdCBBZG9iZS5QUEtMaXRlIGFkYmUucGtjczcuZGV0YWNoZWQgZXhwZWN0cy5cbiAgICAgICAgcDcuYWRkU2lnbmVyKHtcbiAgICAgICAgICAgIGtleTogcHJpdmF0ZUtleSxcbiAgICAgICAgICAgIGNlcnRpZmljYXRlLFxuICAgICAgICAgICAgZGlnZXN0QWxnb3JpdGhtOiBwa2kub2lkcy5zaGEyNTYsXG4gICAgICAgICAgICBhdXRoZW50aWNhdGVkQXR0cmlidXRlczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogcGtpLm9pZHMuY29udGVudFR5cGUsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBwa2kub2lkcy5kYXRhLFxuICAgICAgICAgICAgICAgIH0sIHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogcGtpLm9pZHMubWVzc2FnZURpZ2VzdCxcbiAgICAgICAgICAgICAgICAgICAgLy8gdmFsdWUgd2lsbCBiZSBhdXRvLXBvcHVsYXRlZCBhdCBzaWduaW5nIHRpbWVcbiAgICAgICAgICAgICAgICB9LCB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IHBraS5vaWRzLnNpZ25pbmdUaW1lLFxuICAgICAgICAgICAgICAgICAgICAvLyB2YWx1ZSBjYW4gYWxzbyBiZSBhdXRvLXBvcHVsYXRlZCBhdCBzaWduaW5nIHRpbWVcbiAgICAgICAgICAgICAgICAgICAgLy8gV2UgbWF5IGFsc28gc3VwcG9ydCBwYXNzaW5nIHRoaXMgYXMgYW4gb3B0aW9uIHRvIHNpZ24oKS5cbiAgICAgICAgICAgICAgICAgICAgLy8gV291bGQgYmUgdXNlZnVsIHRvIG1hdGNoIHRoZSBjcmVhdGlvbiB0aW1lIG9mIHRoZSBkb2N1bWVudCBmb3IgZXhhbXBsZS5cbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IG5ldyBEYXRlKCkudG9EYXRlU3RyaW5nKCksIC8vIG5ldyBEYXRlKClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gU2lnbiBpbiBkZXRhY2hlZCBtb2RlLlxuICAgICAgICBwNy5zaWduKHtkZXRhY2hlZDogdHJ1ZX0pO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSBQREYgaGFzIGEgZ29vZCBlbm91Z2ggcGxhY2Vob2xkZXIgdG8gZml0IHRoZSBzaWduYXR1cmUuXG4gICAgICAgIGNvbnN0IHJhdyA9IGFzbjEudG9EZXIocDcudG9Bc24xKCkpLmdldEJ5dGVzKCk7XG4gICAgICAgIC8vIHBsYWNlaG9sZGVyTGVuZ3RoIHJlcHJlc2VudHMgdGhlIGxlbmd0aCBvZiB0aGUgSEVYaWZpZWQgc3ltYm9scyBidXQgd2UncmVcbiAgICAgICAgLy8gY2hlY2tpbmcgdGhlIGFjdHVhbCBsZW5ndGhzLlxuICAgICAgICBpZiAoKHJhdy5sZW5ndGggKiAyKSA+IHBsYWNlaG9sZGVyTGVuZ3RoKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgU2lnblBkZkVycm9yKFxuICAgICAgICAgICAgICAgIGBTaWduYXR1cmUgZXhjZWVkcyBwbGFjZWhvbGRlciBsZW5ndGg6ICR7cmF3Lmxlbmd0aCAqIDJ9ID4gJHtwbGFjZWhvbGRlckxlbmd0aH1gLFxuICAgICAgICAgICAgICAgIEVSUk9SX1RZUEVfSU5QVVQsXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHNpZ25hdHVyZSA9IEJ1ZmZlci5mcm9tKHJhdywgJ2JpbmFyeScpLnRvU3RyaW5nKCdoZXgnKTtcbiAgICAgICAgLy8gU3RvcmUgdGhlIEhFWGlmaWVkIHNpZ25hdHVyZS4gQXQgbGVhc3QgdXNlZnVsIGluIHRlc3RzLlxuICAgICAgICB0aGlzLmxhc3RTaWduYXR1cmUgPSBzaWduYXR1cmU7XG5cbiAgICAgICAgLy8gUGFkIHRoZSBzaWduYXR1cmUgd2l0aCB6ZXJvZXMgc28gdGhlIGl0IGlzIHRoZSBzYW1lIGxlbmd0aCBhcyB0aGUgcGxhY2Vob2xkZXJcbiAgICAgICAgc2lnbmF0dXJlICs9IEJ1ZmZlclxuICAgICAgICAgICAgLmZyb20oU3RyaW5nLmZyb21DaGFyQ29kZSgwKS5yZXBlYXQoKHBsYWNlaG9sZGVyTGVuZ3RoIC8gMikgLSByYXcubGVuZ3RoKSlcbiAgICAgICAgICAgIC50b1N0cmluZygnaGV4Jyk7XG5cbiAgICAgICAgLy8gUGxhY2UgaXQgaW4gdGhlIGRvY3VtZW50LlxuICAgICAgICBwZGYgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgICAgICAgIHBkZi5zbGljZSgwLCBieXRlUmFuZ2VbMV0pLFxuICAgICAgICAgICAgQnVmZmVyLmZyb20oYDwke3NpZ25hdHVyZX0+YCksXG4gICAgICAgICAgICBwZGYuc2xpY2UoYnl0ZVJhbmdlWzFdKSxcbiAgICAgICAgXSk7XG5cbiAgICAgICAgLy8gTWFnaWMuIERvbmUuXG4gICAgICAgIHJldHVybiBwZGY7XG4gICAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBuZXcgU2lnblBkZigpO1xuIl19