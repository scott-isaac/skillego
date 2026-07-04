import SwiftUI

/// Matches styles.css's #resign-button: button.png background (stretched to
/// fit), gold Cinzel-style text with a black drop shadow.
struct ResignButtonView: View {
    let fontScale: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if let button = GameAssetImage.button {
                    Image(uiImage: button).resizable()
                } else {
                    RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.8))
                }
                Text("RESIGN")
                    .font(.system(size: 30 * fontScale, weight: .bold, design: .serif))
                    .tracking(4 * fontScale)
                    .foregroundStyle(Color(hex: "FFD700"))
                    .shadow(color: .black.opacity(0.95), radius: 1, x: 1, y: 1)
                    .shadow(color: Color(hex: "FFC83C").opacity(0.4), radius: 6)
            }
        }
        .buttonStyle(.plain)
    }
}
