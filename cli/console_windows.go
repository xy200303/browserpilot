//go:build windows

package main

import "syscall"

func enableUTF8Console() {
	syscall.NewLazyDLL("kernel32.dll").NewProc("SetConsoleOutputCP").Call(65001)
}
