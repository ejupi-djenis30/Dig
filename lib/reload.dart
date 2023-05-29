import 'package:flutter/material.dart';
import 'dart:math' as math;

// ignore: must_be_immutable
class ReloadButton extends StatefulWidget {
  bool isLoading;
  final void Function(String) searchFunction;
  String? currentUrl;

  ReloadButton(
      {super.key,
      required this.isLoading,
      required this.currentUrl,
      required this.searchFunction});

  @override
  _ReloadButtonState createState() => _ReloadButtonState();
}

class _ReloadButtonState extends State<ReloadButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _rotationAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: Duration(seconds: 1),
      vsync: this,
    );

    _rotationAnimation = Tween(begin: 0.0, end: 1.0).animate(_controller);

    if (widget.isLoading) {
      _startRotation();
    }
  }

  @override
  void didUpdateWidget(ReloadButton oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (widget.isLoading && !oldWidget.isLoading) {
      _startRotation();
    } else if (!widget.isLoading && oldWidget.isLoading) {
      _stopRotation();
    }
  }

  void _startRotation() {
    setState(() {
      widget.isLoading = true;
    });
    _controller.repeat();
  }

  void _stopRotation() {
    setState(() {
      widget.isLoading = false;
    });
    _controller.reset();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: AnimatedBuilder(
        animation: _rotationAnimation,
        builder: (context, child) {
          return Transform.rotate(
            angle: widget.isLoading
                ? _rotationAnimation.value * 2.0 * -math.pi
                : 0.0,
            child: Icon(
              Icons.replay_sharp,
              color: Color(0xFFB9B9B9),
              size: 24,
            ),
          );
        },
      ),
      onPressed: () {
        if (widget.currentUrl != null) {
          widget.searchFunction(widget.currentUrl!);
        } else {
          if (widget.isLoading) {
            _stopRotation();
          } else {
            _startRotation();
          }
        }
      },
    );
  }
}
