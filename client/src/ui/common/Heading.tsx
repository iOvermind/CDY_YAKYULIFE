import type { ReactNode } from 'react';
import styles from './heading.module.css';

/**
 * 大標：一個區塊的名字（INTERFACE.md §4.1）。
 *
 * `aside` 是標題右邊的附註（成就櫃的 AP、更新紀錄的日期），靠右放。`collapsible` 是
 * 放在 `<details><summary>` 裡的那一種：■ 換成會轉向的 ▸。
 */
export function Heading({
  children,
  aside,
  collapsible = false,
  as: Tag = 'h4',
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  collapsible?: boolean;
  as?: 'h2' | 'h3' | 'h4';
  className?: string | undefined;
}) {
  const cls = [styles.heading, collapsible && styles.collapsible, className].filter(Boolean).join(' ');
  return (
    <Tag className={cls}>
      {children}
      {aside !== undefined && <span className={styles.aside}>{aside}</span>}
    </Tag>
  );
}

/**
 * 小標：區塊裡的分組名。`centered` 是兩側帶破折線的置中版（能力面板的分組）。
 * 表單的欄位名也是小標，那時用 `as="label"` 並帶 `htmlFor`。
 */
export function Subheading({
  children,
  centered = false,
  as: Tag = 'div',
  htmlFor,
  className,
}: {
  children: ReactNode;
  centered?: boolean;
  as?: 'div' | 'h5' | 'label' | 'p';
  htmlFor?: string;
  className?: string | undefined;
}) {
  const cls = [styles.subheading, centered && styles.centered, className].filter(Boolean).join(' ');
  return Tag === 'label' ? (
    <label className={cls} htmlFor={htmlFor}>
      {children}
    </label>
  ) : (
    <Tag className={cls}>{children}</Tag>
  );
}
