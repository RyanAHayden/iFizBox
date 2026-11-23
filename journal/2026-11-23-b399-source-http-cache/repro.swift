import Foundation
// argv: url policy(0 = protocol, 5 = revalidating, 1 = ignore local); two processes sharing a disk cache stand in for a relaunch
let cfg = URLSessionConfiguration.default
cfg.requestCachePolicy = NSURLRequest.CachePolicy(rawValue: UInt(CommandLine.arguments[2])!)!
let s = URLSession(configuration: cfg)
let sem = DispatchSemaphore(value: 0)
for _ in 0..<2 {
  s.dataTask(with: URL(string: CommandLine.arguments[1])!) { d, r, e in
    print((r as? HTTPURLResponse)?.statusCode ?? -1, String(decoding: d ?? Data(), as: UTF8.self).prefix(20), e.map { "\($0)" } ?? ""); sem.signal() }.resume()
  sem.wait(); Thread.sleep(forTimeInterval: 1.5)
}
