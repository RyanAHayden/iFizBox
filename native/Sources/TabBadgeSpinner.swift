// B441: the white iOS 26 spinner in a tab's red badge (NativeGlass's UITabBar; the Sources tab while sources refresh).
// UIKit has no spinner badge: badgeValue is text, and "" draws a plain dot. The tab gets a badge holding one digit-wide
// blank (`mark`), so UIKit sizes and places it as it does "1", and a UIActivityIndicatorView goes into each badge
// showing that blank. Inside the badge it moves, scales and fades with it (the bar shrinking on scroll, the lens). The
// bar draws its tabs more than once and makes them anew as it shrinks, so they are looked for a few times a second
// while a badge spins, and not at all otherwise. A badge is told by its blank, never by UIKit's class names.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

@available(iOS 26.0, *)
final class TabBadgeSpinner {
    static let mark = "\u{2007}" // a figure space: blank, as wide as a digit
    private static let part: CGFloat = 0.8 // of the badge's height (the page's own: 16 of 20 px)
    private weak var bar: UITabBar?
    private var timer: Timer?
    private let spinners = NSHashTable<UIActivityIndicatorView>.weakObjects()

    init(bar: UITabBar) { self.bar = bar }
    deinit { timer?.invalidate() }

    // Whether some tab's badge is `mark` now.
    var spinning = false {
        didSet {
            guard spinning != oldValue else { return }
            timer?.invalidate()
            timer = nil
            if spinning {
                let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in self?.place() }
                RunLoop.main.add(t, forMode: .common) // while a finger scrolls too
                timer = t
            }
            place()
        }
    }

    private func place() {
        var labels: [UILabel] = []
        func walk(_ v: UIView) {
            for s in v.subviews {
                if let l = s as? UILabel, l.text == Self.mark { labels.append(l) } else { walk(s) }
            }
        }
        if spinning, let bar {
            bar.layoutIfNeeded()
            walk(bar)
        }
        let badges = labels.compactMap(\.superview)
        for s in spinners.allObjects where !badges.contains(where: { $0 === s.superview }) {
            s.removeFromSuperview()
            spinners.remove(s)
        }
        for badge in badges {
            let s: UIActivityIndicatorView
            if let old = spinners.allObjects.first(where: { $0.superview === badge }) {
                s = old
            } else {
                s = UIActivityIndicatorView(style: .medium)
                s.color = .white
                s.hidesWhenStopped = false
                s.isUserInteractionEnabled = false
                s.isAccessibilityElement = false
                badge.addSubview(s)
                spinners.add(s)
            }
            let k = badge.bounds.height * Self.part / max(1, s.intrinsicContentSize.height)
            s.transform = CGAffineTransform(scaleX: k, y: k)
            s.center = CGPoint(x: badge.bounds.midX, y: badge.bounds.midY)
            if !s.isAnimating { s.startAnimating() }
        }
    }
}
