import logo_url from '../../../resources/icon.svg'
import { APP_NAME } from '../../shared/branding'

// 鲜亮蓝青底色与单字母 C，使用同一矢量源保持各处标识一致。
export function BrandMark(): React.JSX.Element {
  return <img className="brand-mark" src={logo_url} alt={APP_NAME} draggable={false} />
}
