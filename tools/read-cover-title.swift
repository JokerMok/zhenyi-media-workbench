import Foundation
import Vision

let image = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = false
try VNImageRequestHandler(url: image).perform([request])

let lines = (request.results ?? []).sorted {
    let left = $0.boundingBox
    let right = $1.boundingBox
    if abs(left.midY - right.midY) < 0.025 { return left.minX < right.minX }
    return left.midY > right.midY
}
for line in lines {
    if let text = line.topCandidates(1).first?.string { print(text) }
}
