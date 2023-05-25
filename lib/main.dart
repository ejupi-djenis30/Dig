import 'package:flutter/material.dart';

import 'home.dart';

void main() {
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dig Browser',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: MyHomePage(title: 'Dig Browser'),
    );
  }
}

class MyHomePage extends StatefulWidget {
  MyHomePage({Key? key, required this.title}) : super(key: key);
  final String title;

  @override
  _MyHomePageState createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool isFavorite = false;
  bool showAppBar = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    _tabController.addListener(_handleTabSelection);
  }

  void _handleTabSelection() {
    setState(() {
      if (_tabController.index == 0) {
        showAppBar = true;
      } else {
        showAppBar = false;
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: showAppBar
          ? AppBar(
              backgroundColor: Color(0xFF2E2E2E),
              automaticallyImplyLeading: true,
              leading: IconButton(
                icon: Icon(
                  Icons.replay_sharp,
                  color: Color(0xFFB9B9B9),
                  size: 24,
                ),
                onPressed: () {
                  print('ReloadButton pressed ...');
                },
              ),
              title: TextField(
                decoration: InputDecoration(
                  hintText: 'Search',
                  hintStyle: TextStyle(
                    fontFamily: 'Poppins',
                    color: Color(0xFF454545),
                  ),
                  enabledBorder: UnderlineInputBorder(
                    borderSide: BorderSide(
                      color: Color(0xFFE8E8E8),
                      width: 1,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  focusedBorder: UnderlineInputBorder(
                    borderSide: BorderSide(
                      color: Color(0xFF5C5C5C),
                      width: 1,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  errorBorder: UnderlineInputBorder(
                    borderSide: BorderSide(
                      color: Color(0xFFFF7F7F),
                      width: 1,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  focusedErrorBorder: UnderlineInputBorder(
                    borderSide: BorderSide(
                      color: Color(0xFFFF7F7F),
                      width: 1,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  filled: true,
                  fillColor: Color(0xFFB9B9B9),
                  suffixIcon: Icon(
                    Icons.http,
                    color: Color(0xFF454545),
                  ),
                ),
                style: TextStyle(
                  fontFamily: 'Poppins',
                  color: Color(0xFF454545),
                ),
                textAlign: TextAlign.start,
              ),
              actions: [
                IconButton(
                  icon: Icon(
                    isFavorite ? Icons.star : Icons.star_outline_rounded,
                    color: Color(0xFFB9B9B9),
                    size: 24,
                  ),
                  onPressed: () {
                    setState(() {
                      isFavorite = !isFavorite;
                    });
                    print('PreferedButton pressed ...');
                  },
                ),
              ],
              centerTitle: true,
              elevation: 4,
            )
          : null,
      body: TabBarView(
        controller: _tabController,
        children: [
          HomeWidget(),
          Container(), // Placeholder for second tab
          Container(), // Placeholder for third tab
          Container(), // Placeholder for fourth tab
          Container(), // Placeholder for fifth tab
        ],
      ),
      bottomNavigationBar: TabBar(
        controller: _tabController,
        unselectedLabelColor: Color(0xFFB9B9B9),
        labelColor: Color(0xFF2E2E2E),
        indicatorColor: Colors.transparent,
        tabs: [
          Tab(
            icon: Icon(Icons.home),
          ),
          Tab(
            icon: Icon(Icons.history),
          ),
          Tab(
            icon: Icon(Icons.star),
          ),
          Tab(
            icon: Icon(Icons.settings),
          ),
          Tab(
            icon: Icon(Icons.download),
          ),
        ],
      ),
    );
  }
}
