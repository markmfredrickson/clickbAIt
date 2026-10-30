// Find people in a video with Apple's Vision framework, a few times a second.
//   people <video> <start> <end> <rate>   → JSON lines: {"t":…, "boxes":[[x,y,w,h,confidence],…]}
// Boxes are fractions of the frame, top-left origin.
import AVFoundation
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 5, let start = Double(args[2]), let end = Double(args[3]), let rate = Double(args[4]) else {
  FileHandle.standardError.write("usage: people <video> <start> <end> <rate>\n".data(using: .utf8)!)
  exit(1)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 1280, height: 1280)

var t = start
while t <= end + 1e-6 {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let image = try? gen.copyCGImage(at: time, actualTime: nil) {
    let request = VNDetectHumanRectanglesRequest()
    request.upperBodyOnly = false
    try? VNImageRequestHandler(cgImage: image).perform([request])
    let boxes = (request.results ?? []).map { o -> String in
      let b = o.boundingBox
      return String(format: "[%.4f,%.4f,%.4f,%.4f,%.3f]", b.minX, 1 - b.maxY, b.width, b.height, o.confidence)
    }
    print("{\"t\":\(String(format: "%.3f", t)),\"boxes\":[\(boxes.joined(separator: ","))]}")
  }
  t += 1 / rate
}
